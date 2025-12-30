let files = {};
let activeFileName = null;
let parseTimeout;
let isInteracting = false;
let isPreviewMode = false;

function injectIDE() {
    if (document.getElementById('gemini-dev-ide')) return;

    const idePanel = document.createElement('div');
    idePanel.id = 'gemini-dev-ide';

    const iconDownload = `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
    const iconPlay = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
    const iconPause = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    const iconClear = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

    idePanel.innerHTML = `
        <div class="ide-header">
            <strong style="color:#D0BCFF; font-size:16px;">Gemini Forge</strong>
            <span id="status-indicator" style="font-size:10px; color:#aaa; margin-left:10px;"></span>
            <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                <button id="download-btn" class="icon-btn" title="Download ZIP">${iconDownload}</button>
                <button id="clear-btn" class="icon-btn" title="Clear Project">${iconClear}</button>
                <div style="width:1px; height:24px; background:#49454F; margin:0 4px;"></div>
                <button id="play-pause-btn" class="icon-btn" title="Run Live">${iconPlay}</button>
            </div>
        </div>
        <div class="ide-body">
            <div id="file-tree"></div>
            <div id="main-editor-view">
                <div id="editor-container">
                    <pre id="code-display-container" style="margin:0; font-family: monospace; white-space: pre-wrap; color: #e0e0e0;"></pre>
                </div>
                <div id="preview-container" style="display:none;">
                    <iframe id="live-preview-frame" style="width:100%; height:100%; border:none; background:white;"></iframe>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(idePanel);

    const playBtn = document.getElementById('play-pause-btn');

    playBtn.onclick = () => {
        const previewContainer = document.getElementById('preview-container');
        const fileTree = document.getElementById('file-tree');

        if (!isPreviewMode) {
            if (!files['index.html']) {
                alert("Cannot run: index.html is missing!\n(Tip: Ask Gemini to generate it)");
                return;
            }

            runLivePreview();

            fileTree.style.display = 'none';
            previewContainer.style.display = 'block';

            playBtn.innerHTML = iconPause;
            playBtn.classList.add('playing');
            playBtn.title = "Stop Preview";
            isPreviewMode = true;
        } else {
            previewContainer.style.display = 'none';
            fileTree.style.display = 'block';

            playBtn.innerHTML = iconPlay;
            playBtn.classList.remove('playing');
            playBtn.title = "Run Live";
            isPreviewMode = false;
            document.getElementById('live-preview-frame').src = '';
        }
    };

    document.getElementById('clear-btn').onclick = () => {
        files = {};
        activeFileName = null;
        renderFileTree();
        document.getElementById('code-display-container').innerText = "// Ready to forge...";
        document.getElementById('status-indicator').innerText = "";
        if (isPreviewMode) playBtn.click();
    };

    document.getElementById('download-btn').onclick = () => downloadAsZip();

    if (document.querySelector('main')) {
        document.querySelector('main').style.marginRight = '50vw';
        document.querySelector('main').style.transition = 'margin-right 0.3s ease';
    }
}

function runLivePreview() {
    const iframe = document.getElementById('live-preview-frame');
    if (!iframe) return;

    let finalHtml = files['index.html'] || '';

    if (!finalHtml.toLowerCase().includes('<!doctype html>')) {
        finalHtml = '<!DOCTYPE html>\n' + finalHtml;
    }
    if (!finalHtml.toLowerCase().includes('<html')) {
        finalHtml = `<!DOCTYPE html><html><body>${finalHtml}</body></html>`;
    }

    let cssStyles = "";
    Object.keys(files).forEach(filename => {
        if (filename.endsWith('.css')) {
            cssStyles += `\n/* --- ${filename} --- */\n${files[filename]}\n`;
        }
    });

    let jsScripts = "";
    Object.keys(files).forEach(filename => {
        if (filename.endsWith('.js')) {
            jsScripts += `\n/* --- ${filename} --- */\n${files[filename]}\n`;
        }
    });

    finalHtml = finalHtml.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, '');

    const forceHeightCss = `
        html, body { 
            height: 100% !important; 
            margin: 0 !important; 
            padding: 0 !important; 
            width: 100% !important; 
            overflow-x: hidden;
        }
    `;
    cssStyles = `${forceHeightCss}\n${cssStyles}`;

    const styleTag = `<style>${cssStyles}</style>`;
    if (finalHtml.includes('</head>')) {
        finalHtml = finalHtml.replace('</head>', `${styleTag}\n</head>`);
    } else if (finalHtml.includes('<html>')) {
        finalHtml = finalHtml.replace('<html>', `<html><head>${styleTag}</head>`);
    } else {
        finalHtml = `${styleTag}\n${finalHtml}`;
    }

    const scriptTag = `<script>${jsScripts}</script>`;
    if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${scriptTag}\n</body>`);
    } else {
        finalHtml = `${finalHtml}\n${scriptTag}`;
    }

    const blob = new Blob([finalHtml], { type: 'text/html' });
    iframe.src = URL.createObjectURL(blob);
}

function parseResponse() {
    if (isInteracting) return;

    const messages = document.querySelectorAll('.model-response-text, .markdown');
    let changed = false;

    messages.forEach(msg => {
        const text = msg.innerText;

        const nameRegex = /\[File:\s*([\w\.\-\s]+\.[a-z0-9]+)\]/gi;
        let foundNames = [];
        let nameMatch;
        while ((nameMatch = nameRegex.exec(text)) !== null) {
            if (nameMatch[1].toLowerCase() !== "filename.ext") {
                foundNames.push(nameMatch[1].trim());
            }
        }

        const codeBlocks = msg.querySelectorAll('pre');

        codeBlocks.forEach((block, index) => {
            if (foundNames[index]) {
                const fileName = foundNames[index];
                const content = block.innerText.trim();

                if (files[fileName] !== content) {
                    files[fileName] = content;
                    changed = true;
                }
            }
        });
    });

    if (changed) {
        renderFileTree();
        const indicator = document.getElementById('status-indicator');
        if(indicator) indicator.innerText = `${Object.keys(files).length} files`;

        if (isPreviewMode) runLivePreview();

        if (!activeFileName && Object.keys(files).length > 0) {
            updateDisplay(Object.keys(files)[0]);
        }
    }
}

function downloadAsZip() {
    if (typeof JSZip === 'undefined') {
        alert("Error: JSZip is missing.");
        return;
    }
    if (Object.keys(files).length === 0) return alert("No files to download!");

    const zip = new JSZip();
    Object.keys(files).forEach(filename => zip.file(filename, files[filename]));

    zip.generateAsync({type:"blob"}).then(content => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = "gemini-forge-project.zip";
        a.click();
    });
}

function updateDisplay(fileName) {
    activeFileName = fileName;
    const display = document.getElementById('code-display-container');
    if (!display || !files[fileName]) return;

    display.innerText = files[fileName];

    document.querySelectorAll('.file-item').forEach(el => {
        if (el.dataset.name === fileName) el.setAttribute('data-active', 'true');
        else el.removeAttribute('data-active');
    });
}

function renderFileTree() {
    const tree = document.getElementById('file-tree');
    if (!tree) return;
    tree.innerHTML = '';
    Object.keys(files).forEach(name => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.name = name;
        item.innerText = name;
        if (name === activeFileName) item.setAttribute('data-active', 'true');
        item.onclick = (e) => {
            e.stopPropagation();
            isInteracting = true;
            updateDisplay(name);
            setTimeout(() => { isInteracting = false; }, 500);
        };
        tree.appendChild(item);
    });
}

const observer = new MutationObserver((mutations) => {
    for (let m of mutations) { if (m.target.closest && m.target.closest('#gemini-dev-ide')) return; }
    clearTimeout(parseTimeout);
    parseTimeout = setTimeout(parseResponse, 800);
});

window.addEventListener('load', () => {
    setTimeout(() => { injectIDE(); observer.observe(document.body, { childList: true, subtree: true }); }, 3000);
});