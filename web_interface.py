from flask import Flask, render_template, jsonify, request, redirect, url_for, flash
import os, json, asyncio
from organisemedia import create_symlinks, get_settings, init_locks
from functools import partial

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'  # Required for flash messages

# Global variable to store background task status
task_status = {
    'running': False,
    'last_message': '',
    'messages': []
}

def log_to_web(message, level="INFO"):
    task_status['last_message'] = f"{level}: {message}"
    task_status['messages'].append(f"{level}: {message}")
    if len(task_status['messages']) > 100:  # Keep only last 100 messages
        task_status['messages'].pop(0)

async def run_symlink_task(src_dir, dest_dir, split_dirs=False, force=False):
    task_status['running'] = True
    task_status['messages'] = []
    try:
        init_locks()
        await create_symlinks(src_dir, dest_dir, force=force, split=split_dirs)
    except Exception as e:
        log_to_web(f"Error: {str(e)}", "ERROR")
    finally:
        task_status['running'] = False

@app.route('/')
def index():
    settings = get_settings()
    dest_dir = settings.get('dest_dir', '/mnt/realdebrid')
    
    media = {
        'shows': [],
        'anime_shows': [],
        'movies': []
    }
    
    # Scan shows directory
    shows_dir = os.path.join(dest_dir, 'shows')
    if os.path.exists(shows_dir):
        for show in sorted(os.listdir(shows_dir)):
            show_path = os.path.join(shows_dir, show)
            if os.path.isdir(show_path):
                seasons = sorted([s for s in os.listdir(show_path) if os.path.isdir(os.path.join(show_path, s))])
                media['shows'].append({
                    'name': show,
                    'seasons': seasons,
                    'path': show_path
                })

    # Scan anime shows directory
    anime_dir = os.path.join(dest_dir, 'anime_shows')
    if os.path.exists(anime_dir):
        for show in sorted(os.listdir(anime_dir)):
            show_path = os.path.join(anime_dir, show)
            if os.path.isdir(show_path):
                seasons = sorted([s for s in os.listdir(show_path) if os.path.isdir(os.path.join(show_path, s))])
                media['anime_shows'].append({
                    'name': show,
                    'seasons': seasons,
                    'path': show_path
                })

    # Scan movies directory
    movies_dir = os.path.join(dest_dir, 'movies')
    if os.path.exists(movies_dir):
        for movie in sorted(os.listdir(movies_dir)):
            movie_path = os.path.join(movies_dir, movie)
            if os.path.isdir(movie_path):
                media['movies'].append({
                    'name': movie,
                    'path': movie_path
                })

    return render_template('index.html', 
                         media=media, 
                         task_status=task_status,
                         settings=settings)

@app.route('/start_scan', methods=['POST'])
def start_scan():
    settings = get_settings()
    split_dirs = request.form.get('split_dirs') == 'true'
    force = request.form.get('force') == 'true'
    
    if not task_status['running']:
        asyncio.run(run_symlink_task(
            settings['src_dir'],
            settings['dest_dir'],
            split_dirs=split_dirs,
            force=force
        ))
        flash('Scan completed!', 'success')
    else:
        flash('A scan is already running!', 'warning')
    
    return redirect(url_for('index'))

@app.route('/status')
def get_status():
    return jsonify(task_status)

@app.route('/delete_symlink', methods=['POST'])
def delete_symlink():
    path = request.form.get('path')
    if os.path.exists(path):
        try:
            if os.path.islink(path):
                os.unlink(path)
                flash('Symlink deleted successfully!', 'success')
            else:
                flash('Not a symlink!', 'error')
        except Exception as e:
            flash(f'Error deleting symlink: {str(e)}', 'error')
    return redirect(url_for('index'))

@app.route('/update_symlink', methods=['POST'])
def update_symlink():
    path = request.form.get('path')
    if os.path.exists(path):
        try:
            settings = get_settings()
            dest_dir = settings.get('dest_dir')
            
            # Get the current symlink target
            target = os.readlink(path)
            
            # Delete old symlink
            os.unlink(path)
            
            # Create new symlink with force=True to update
            asyncio.run(run_symlink_task(
                settings['src_dir'],
                dest_dir,
                split_dirs=True,
                force=True
            ))
            
            flash('Symlink updated successfully!', 'success')
        except Exception as e:
            flash(f'Error updating symlink: {str(e)}', 'error')
    return redirect(url_for('index'))

@app.route('/move_symlink', methods=['POST'])
def move_symlink():
    path = request.form.get('path')
    destination = request.form.get('destination')  # 'shows' or 'anime_shows'
    
    log_to_web(f"Attempting to move symlink from {path} to {destination}", "INFO")
    
    if os.path.exists(path):
        try:
            settings = get_settings()
            dest_dir = settings.get('dest_dir')
            
            # Get current symlink info
            show_name = os.path.basename(os.path.dirname(path))
            season = os.path.basename(path)
            target = os.readlink(path)
            
            log_to_web(f"Show: {show_name}, Season: {season}", "DEBUG")
            log_to_web(f"Current target: {target}", "DEBUG")
            
            # Create new path
            new_base_path = os.path.join(dest_dir, destination, show_name)
            new_path = os.path.join(new_base_path, season)
            
            log_to_web(f"New path will be: {new_path}", "DEBUG")
            
            # Create directory if it doesn't exist
            os.makedirs(new_base_path, exist_ok=True)
            
            # Delete old symlink
            log_to_web(f"Deleting old symlink at {path}", "DEBUG")
            os.unlink(path)
            
            # Create new symlink
            log_to_web(f"Creating new symlink: {new_path} -> {target}", "DEBUG")
            os.symlink(target, new_path)
            
            flash(f'Symlink moved to {destination}!', 'success')
        except Exception as e:
            log_to_web(f'Error moving symlink: {str(e)}', "ERROR")
            flash(f'Error moving symlink: {str(e)}', 'error')
    else:
        log_to_web(f"Path does not exist: {path}", "ERROR")
        flash('Path does not exist!', 'error')
    return redirect(url_for('index'))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 