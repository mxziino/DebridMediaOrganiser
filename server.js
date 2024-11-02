const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();
const port = 5000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Global task status
let taskStatus = {
    running: false,
    lastMessage: '',
    messages: []
};

// Load settings
async function getSettings() {
    try {
        const data = await fs.readFile('settings.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading settings:', error);
        return {};
    }
}

// Log messages
function logToWeb(message, level = "INFO") {
    const logMessage = `${level}: ${message}`;
    taskStatus.lastMessage = logMessage;
    taskStatus.messages.push(logMessage);
    if (taskStatus.messages.length > 100) {
        taskStatus.messages.shift();
    }
    console.log(logMessage);
}

// Run symlink creation task
async function runSymlinkTask(srcDir, destDir, splitDirs = false, force = false) {
    taskStatus.running = true;
    taskStatus.messages = [];
    try {
        const cmd = `python3 organisemedia.py ${srcDir} ${destDir} ${splitDirs ? '--split-dirs' : ''} ${force ? '--force' : ''}`;
        const { stdout, stderr } = await execAsync(cmd);
        logToWeb(stdout);
        if (stderr) logToWeb(stderr, "ERROR");
    } catch (error) {
        logToWeb(`Error: ${error.message}`, "ERROR");
    } finally {
        taskStatus.running = false;
    }
}

// Get task status
async function getTaskStatus() {
    try {
        const statusPath = path.join(__dirname, 'status.json');
        const exists = await fs.access(statusPath).then(() => true).catch(() => false);
        
        if (!exists) {
            return {
                running: false,
                messages: []
            };
        }

        const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));
        return status;
    } catch (error) {
        console.error('Error reading task status:', error);
        return {
            running: false,
            messages: []
        };
    }
}

// Add these utility functions
async function updateTaskStatus(status) {
    const statusPath = path.join(__dirname, 'status.json');
    await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
}

async function addStatusMessage(message) {
    const status = await getTaskStatus();
    status.messages.push(message);
    // Keep only the last 50 messages
    if (status.messages.length > 50) {
        status.messages = status.messages.slice(-50);
    }
    await updateTaskStatus(status);
}

// Modify your scan endpoint to use the status tracking
app.post('/scan', async (req, res) => {
    try {
        const { split_dirs, force } = req.body;
        const settings = await getSettings();

        // Check if a scan is already running
        const status = await getTaskStatus();
        if (status.running) {
            return res.status(400).json({ error: 'A scan is already in progress' });
        }

        // Update status to running
        await updateTaskStatus({
            running: true,
            messages: ['Starting media scan...']
        });

        // Send immediate response
        res.json({ message: 'Scan started' });

        // Run the Python script
        const cmd = `python3 organisemedia.py --source "${settings.src_dir}" --destination "${settings.dest_dir}" ${split_dirs ? '--split-dirs' : ''} ${force ? '--force' : ''}`;
        
        const child = exec(cmd);

        child.stdout.on('data', async (data) => {
            console.log(data);
            await addStatusMessage(data.trim());
        });

        child.stderr.on('data', async (data) => {
            console.error(data);
            await addStatusMessage(`Error: ${data.trim()}`);
        });

        child.on('close', async (code) => {
            const finalMessage = code === 0 ? 'Scan completed successfully' : 'Scan completed with errors';
            await updateTaskStatus({
                running: false,
                messages: [...(await getTaskStatus()).messages, finalMessage]
            });
        });

    } catch (error) {
        console.error('Error:', error);
        await updateTaskStatus({
            running: false,
            messages: [...(await getTaskStatus()).messages, `Error: ${error.message}`]
        });
        res.status(500).json({ error: error.message });
    }
});

// Add a status endpoint for polling
app.get('/status', async (req, res) => {
    try {
        const status = await getTaskStatus();
        res.json(status);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Routes
app.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        const taskStatus = await getTaskStatus();
        
        // Get media listings
        const srcDir = settings.src_dir;
        const shows = await fs.readdir(srcDir);
        const mediaList = await Promise.all(shows.map(async (show) => {
            const fullPath = path.join(srcDir, show);
            const stats = await fs.lstat(fullPath);
            return {
                name: show,
                path: fullPath,
                isSymlink: stats.isSymbolicLink()
            };
        }));

        res.render('index', {
            settings,
            taskStatus,
            mediaList
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Error loading media library');
    }
});

app.post('/start_scan', async (req, res) => {
    const settings = await getSettings();
    const splitDirs = req.body.split_dirs === 'true';
    const force = req.body.force === 'true';

    if (!taskStatus.running) {
        runSymlinkTask(settings.src_dir, settings.dest_dir, splitDirs, force);
        res.json({ message: 'Scan started' });
    } else {
        res.status(400).json({ error: 'A scan is already running' });
    }
});

app.get('/status', (req, res) => {
    res.json(taskStatus);
});

app.post('/move_symlink', async (req, res) => {
    try {
        const { path: sourcePath, destination } = req.body;
        const settings = await getSettings();
        const destDir = settings.dest_dir;

        console.log('Moving symlink:', { sourcePath, destination });

        const exists = await fs.access(sourcePath).then(() => true).catch(() => false);
        if (!exists) {
            throw new Error('Source path does not exist');
        }

        const stats = await fs.lstat(sourcePath);
        const showName = path.basename(path.dirname(sourcePath));
        const season = path.basename(sourcePath);
        const newBasePath = path.join(destDir, destination, showName);
        const newPath = path.join(newBasePath, season);

        await fs.mkdir(newBasePath, { recursive: true });

        if (stats.isSymbolicLink()) {
            // Handle symlink
            const target = await fs.readlink(sourcePath);
            await fs.unlink(sourcePath);
            await fs.symlink(target, newPath);
        } else if (stats.isDirectory()) {
            // Handle directory
            await fs.rename(sourcePath, newPath);
        } else {
            throw new Error('Path is neither a symlink nor a directory');
        }

        res.json({ message: 'Item moved successfully' });
    } catch (error) {
        console.error('Error moving item:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/delete_symlink', async (req, res) => {
    try {
        const { path: symlinkPath } = req.body;
        await fs.unlink(symlinkPath);
        res.json({ message: 'Symlink deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/move_show', async (req, res) => {
    try {
        const { path: sourcePath, destination } = req.body;
        const settings = await getSettings();
        const destDir = settings.dest_dir;

        console.log('Moving show:', { sourcePath, destination });

        const exists = await fs.access(sourcePath).then(() => true).catch(() => false);
        if (!exists) {
            throw new Error('Source path does not exist');
        }

        const showName = path.basename(sourcePath);
        const newPath = path.join(destDir, destination, showName);

        await fs.mkdir(path.dirname(newPath), { recursive: true });

        // Move the entire show directory
        await fs.rename(sourcePath, newPath);

        res.json({ message: 'Show moved successfully' });
    } catch (error) {
        console.error('Error moving show:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/fix_symlink', async (req, res) => {
    try {
        const { path: showPath, imdbId } = req.body;
        const settings = await getSettings();
        
        if (!imdbId) {
            throw new Error('IMDB ID is required');
        }

        // Run the Python script with the fix command
        const cmd = `python3 organisemedia.py --fix "${showPath}" --imdb "${imdbId}"`;
        const { stdout, stderr } = await execAsync(cmd);
        
        if (stderr) {
            throw new Error(stderr);
        }

        res.json({ 
            message: 'Symlink fixed successfully',
            output: stdout
        });
    } catch (error) {
        console.error('Error fixing symlink:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 