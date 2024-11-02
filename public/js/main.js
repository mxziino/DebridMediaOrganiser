let statusPollInterval = null;

function updateStatusBox(status) {
    const statusBox = document.getElementById('statusBox');
    const statusMessages = document.getElementById('statusMessages');
    
    if (status.running) {
        statusBox.style.display = 'block';
        statusMessages.innerHTML = status.messages
            .map(msg => `<div class="py-1">${msg}</div>`)
            .join('');
    } else {
        statusBox.style.display = 'none';
    }
}

function startStatusPolling() {
    if (statusPollInterval) return;
    
    statusPollInterval = setInterval(async () => {
        try {
            const response = await fetch('/status');
            const status = await response.json();
            updateStatusBox(status);
            
            if (!status.running) {
                clearInterval(statusPollInterval);
                statusPollInterval = null;
                location.reload();
            }
        } catch (error) {
            console.error('Error polling status:', error);
        }
    }, 1000);
}

function startScan(event) {
    event.preventDefault();
    const splitDirs = document.getElementById('split_dirs').checked;
    const force = document.getElementById('force').checked;

    fetch('/scan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ split_dirs: splitDirs, force })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            startStatusPolling();
        }
    })
    .catch(error => console.error('Error:', error));
}

function moveSymlink(path, destination) {
    fetch('/move_symlink', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path, destination })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            location.reload();
        }
    })
    .catch(error => console.error('Error:', error));
}

function deleteSymlink(path) {
    if (confirm('Are you sure you want to delete this symlink?')) {
        fetch('/delete_symlink', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                location.reload();
            }
        })
        .catch(error => console.error('Error:', error));
    }
}

function moveShow(showPath, destination) {
    fetch('/move_show', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: showPath, destination })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            location.reload();
        }
    })
    .catch(error => console.error('Error:', error));
}

function fixSymlink(showPath, imdbId) {
    if (!imdbId) {
        alert('Please enter an IMDB ID');
        return;
    }

    // Show loading state
    const button = event.target;
    const originalText = button.innerText;
    button.innerText = 'Fixing...';
    button.disabled = true;

    fetch('/fix_symlink', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            path: showPath, 
            imdbId: imdbId.trim() // Remove any whitespace
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert('Error: ' + data.error);
        } else {
            alert('Symlink fixed successfully');
            location.reload();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to fix symlink: ' + error.message);
    })
    .finally(() => {
        // Reset button state
        button.innerText = originalText;
        button.disabled = false;
    });
}

// Initialize status updates if a task is running
if (taskStatus && taskStatus.running) {
    updateStatus();
} 