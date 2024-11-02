function updateStatus() {
    fetch('/status')
        .then(response => response.json())
        .then(data => {
            const statusBox = document.getElementById('statusBox');
            const statusMessages = document.getElementById('statusMessages');
            
            if (data.running) {
                statusBox.style.display = 'block';
                statusMessages.innerHTML = data.messages.map(msg => `<div>${msg}</div>`).join('');
                setTimeout(updateStatus, 2000);
            } else {
                statusBox.style.display = 'none';
                if (data.messages.length > 0) {
                    location.reload();
                }
            }
        })
        .catch(error => console.error('Error:', error));
}

function startScan(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    fetch('/start_scan', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            updateStatus();
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
    fetch('/fix_symlink', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: showPath, imdbId })
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

// Initialize status updates if a task is running
if (taskStatus && taskStatus.running) {
    updateStatus();
} 