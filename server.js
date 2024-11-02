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

// Routes
app.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        const destDir = settings.dest_dir || '/mnt/realdebrid';
        
        const media = {
            shows: [],
            anime_shows: [],
            movies: []
        };

        // Scan shows directory
        const showsDir = path.join(destDir, 'shows');
        try {
            const shows = await fs.readdir(showsDir);
            for (const show of shows) {
                const showPath = path.join(showsDir, show);
                const stats = await fs.stat(showPath);
                if (stats.isDirectory()) {
                    const seasons = (await fs.readdir(showPath))
                        .filter(async s => (await fs.stat(path.join(showPath, s))).isDirectory());
                    media.shows.push({
                        name: show,
                        seasons,
                        path: showPath
                    });
                }
            }
        } catch (error) {
            console.error('Error scanning shows:', error);
        }

        // Scan anime shows directory
        const animeDir = path.join(destDir, 'anime_shows');
        try {
            const shows = await fs.readdir(animeDir);
            for (const show of shows) {
                const showPath = path.join(animeDir, show);
                const stats = await fs.stat(showPath);
                if (stats.isDirectory()) {
                    const seasons = (await fs.readdir(showPath))
                        .filter(async s => (await fs.stat(path.join(showPath, s))).isDirectory());
                    media.anime_shows.push({
                        name: show,
                        seasons,
                        path: showPath
                    });
                }
            }
        } catch (error) {
            console.error('Error scanning anime:', error);
        }

        // Scan movies directory
        const moviesDir = path.join(destDir, 'movies');
        try {
            const movies = await fs.readdir(moviesDir);
            for (const movie of movies) {
                const moviePath = path.join(moviesDir, movie);
                const stats = await fs.stat(moviePath);
                if (stats.isDirectory()) {
                    media.movies.push({
                        name: movie,
                        path: moviePath
                    });
                }
            }
        } catch (error) {
            console.error('Error scanning movies:', error);
        }

        res.render('index', { media, taskStatus, settings });
    } catch (error) {
        res.status(500).send('Error loading media library: ' + error.message);
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