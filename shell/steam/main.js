// FAVOR Steam shell — Electron window over https://playfavor.net/.
// Same one-codebase posture as the iOS shell: the game ships from the web,
// the shell provides the desktop frame. UA carries "FavorShell-Steam" so
// the site hides the PayPal Royal Mint (Valve routes MTX through its own
// wallet; family posture matches Nation's Steam build).
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const GAME_URL = 'https://playfavor.net/';

function createWindow() {
    const win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#1d1106',
        fullscreenable: true,
        autoHideMenuBar: true,
        title: 'FAVOR',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            partition: 'persist:favor',   // localStorage (favorUid, crests) survives updates
        },
    });

    win.setMenuBarVisibility(false);
    const ua = win.webContents.getUserAgent() + ' FavorShell-Steam/1.0';
    win.webContents.setUserAgent(ua);

    // Links leaving the realm open in the system browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
        try {
            const host = new URL(url).host;
            if (host.endsWith('playfavor.net')) return { action: 'allow' };
        } catch (e) { /* fall through */ }
        shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        try {
            const host = new URL(url).host;
            if (host.endsWith('playfavor.net') || host.includes('firebaseio.com')) return;
        } catch (err) { /* fall through */ }
        e.preventDefault();
        shell.openExternal(url);
    });

    // Offline: honest retry page, then back to the table.
    win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
        if (isMainFrame) win.loadFile(path.join(__dirname, 'retry.html'));
    });

    // F11 toggles fullscreen — a card table likes the whole screen.
    win.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'F11') {
            win.setFullScreen(!win.isFullScreen());
            e.preventDefault();
        }
    });

    win.loadURL(GAME_URL, { userAgent: ua });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
