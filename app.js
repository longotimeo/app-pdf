// Initialize PDF.js worker (disabled remote worker to prevent CORS/SecurityError on file:// protocol)
// PDF.js will automatically fall back to the main-thread fake worker.

// Application State
let pdfDocInstance = null;
let pdfBytes = null;
let currentPageNum = 1;
let currentZoom = 1.0;
let currentTool = 'select'; // 'select', 'whiteout', 'text'
let modifications = {}; // Format: { pageNum: [ {id, type, x, y, width, height, ...} ] }
let selectedElementId = null;
let isDrawing = false;
let startDrawX = 0;
let startDrawY = 0;
let drawElement = null;

// DOM Elements
const pdfFileInput = document.getElementById('pdfFileInput');
const uploadZone = document.getElementById('uploadZone');
const pagesSection = document.getElementById('pagesSection');
const pagesList = document.getElementById('pagesList');
const toolbar = document.getElementById('toolbar');
const documentName = document.getElementById('documentName');
const pdfCanvas = document.getElementById('pdfCanvas');
const editingOverlay = document.getElementById('editingOverlay');
const canvasWrapper = document.getElementById('canvasWrapper');
const noFileOverlay = document.getElementById('noFileOverlay');
const browseBtn = document.getElementById('browseBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevel = document.getElementById('zoomLevel');
const exportBtn = document.getElementById('exportBtn');
const undoBtn = document.getElementById('undoBtn');

// Tools Buttons
const toolSelect = document.getElementById('toolSelect');
const toolWhiteout = document.getElementById('toolWhiteout');
const toolText = document.getElementById('toolText');
const toolCutMove = document.getElementById('toolCutMove');

// Properties Panel
const propertiesPanel = document.getElementById('propertiesPanel');
const noSelectionMsg = document.getElementById('noSelectionMsg');
const propertiesControls = document.getElementById('propertiesControls');
const propTextGroup = document.getElementById('propTextGroup');
const propWhiteoutGroup = document.getElementById('propWhiteoutGroup');
const propTextValue = document.getElementById('propTextValue');
const propFontSize = document.getElementById('propFontSize');
const propFontFamily = document.getElementById('propFontFamily');
const propTextColor = document.getElementById('propTextColor');
const propTextColorHex = document.getElementById('propTextColorHex');
const propFillColor = document.getElementById('propFillColor');
const propFillColorHex = document.getElementById('propFillColorHex');
const deleteElementBtn = document.getElementById('deleteElementBtn');

// --- EVENT LISTENERS ---

// File Upload
uploadZone.addEventListener('click', () => pdfFileInput.click());
browseBtn.addEventListener('click', () => pdfFileInput.click());

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = 'var(--accent)';
    uploadZone.style.background = 'rgba(99, 102, 241, 0.12)';
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    uploadZone.style.background = 'rgba(99, 102, 241, 0.04)';
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    uploadZone.style.background = 'rgba(99, 102, 241, 0.04)';
    if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

pdfFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

// Toolbar Tool Switching
toolSelect.addEventListener('click', () => setTool('select'));
toolWhiteout.addEventListener('click', () => setTool('whiteout'));
toolText.addEventListener('click', () => setTool('text'));
toolCutMove.addEventListener('click', () => setTool('cutmove'));

// Zoom Buttons
zoomInBtn.addEventListener('click', () => adjustZoom(0.1));
zoomOutBtn.addEventListener('click', () => adjustZoom(-0.1));

// Properties Panel Events
propTextValue.addEventListener('input', (e) => updateSelectedElement('text', e.target.value));
propFontSize.addEventListener('input', (e) => updateSelectedElement('fontSize', parseInt(e.target.value) || 12));
propFontFamily.addEventListener('change', (e) => updateSelectedElement('fontFamily', e.target.value));

propTextColor.addEventListener('input', (e) => {
    propTextColorHex.textContent = e.target.value.toUpperCase();
    updateSelectedElement('color', e.target.value);
});

propFillColor.addEventListener('input', (e) => {
    propFillColorHex.textContent = e.target.value.toUpperCase();
    updateSelectedElement('color', e.target.value);
});

deleteElementBtn.addEventListener('click', deleteSelectedElement);
exportBtn.addEventListener('click', exportPDF);
undoBtn.addEventListener('click', undo);

// Prevent undo spam snapshots
let isEditingText = false;
propTextValue.addEventListener('focus', () => {
    if (!isEditingText) {
        saveHistory();
        isEditingText = true;
    }
});
propTextValue.addEventListener('blur', () => {
    isEditingText = false;
});
propFontSize.addEventListener('focus', () => saveHistory());
propFontFamily.addEventListener('change', () => saveHistory());
propTextColor.addEventListener('change', () => saveHistory());
propFillColor.addEventListener('change', () => saveHistory());

// Keyboard deletion
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId) {
        // Prevent deletion if typing in properties input/textarea
        if (document.activeElement !== propTextValue && document.activeElement !== propFontSize) {
            deleteSelectedElement();
        }
    }
});

// Deselect when clicking outside overlay elements
editingOverlay.addEventListener('mousedown', (e) => {
    if (e.target === editingOverlay) {
        deselectElement();
    }
});

// --- CORE FUNCTIONS ---

// Load File
async function handleFileSelect(file) {
    if (file.type !== 'application/pdf') {
        alert('Per favore carica solo file PDF.');
        return;
    }

    documentName.textContent = file.name;
    
    // Read file bytes
    const reader = new FileReader();
    reader.onload = async function() {
        pdfBytes = new Uint8Array(this.result);
        try {
            // Create a copy of the bytes for PDF.js to prevent buffer transfer/neutering
            const pdfjsData = pdfBytes.slice(0);
            // Load using PDF.js
            pdfDocInstance = await pdfjsLib.getDocument({ data: pdfjsData }).promise;
            
            // Initialize modifications
            modifications = {};
            for (let i = 1; i <= pdfDocInstance.numPages; i++) {
                modifications[i] = [];
            }
            
            // Reset to default values
            currentPageNum = 1;
            currentZoom = 1.0;
            zoomLevel.textContent = '100%';
            selectedElementId = null;
            historyStack = [];
            updateUndoButtonState();
            
            // Enable actions
            zoomInBtn.disabled = false;
            zoomOutBtn.disabled = false;
            exportBtn.disabled = false;
            toolbar.style.display = 'flex';
            pagesSection.style.display = 'flex';
            noFileOverlay.style.display = 'none';
            canvasWrapper.style.display = 'block';
            propertiesPanel.style.display = 'block';
            document.getElementById('splitControls').style.display = 'block';
            
            // Render first page and sidebar list
            await renderPage(currentPageNum);
            await renderThumbnails();
            
        } catch (error) {
            console.error('Errore nel caricamento del PDF: ', error);
            alert('Impossibile caricare il PDF.');
        }
    };
    reader.readAsArrayBuffer(file);
}

// Render PDF Page
async function renderPage(pageNum) {
    if (!pdfDocInstance) return;
    
    currentPageNum = pageNum;
    
    // Highlight active thumbnail
    document.querySelectorAll('.page-thumbnail-container').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.page) === pageNum);
    });

    const page = await pdfDocInstance.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentZoom });
    
    const context = pdfCanvas.getContext('2d');
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    
    // Size workspace layout wrapper to fit the canvas precisely
    canvasWrapper.style.width = `${viewport.width}px`;
    canvasWrapper.style.height = `${viewport.height}px`;
    
    const renderContext = {
        canvasContext: context,
        viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Update editing overlay size and content
    renderModifications();
}

// Render thumbnails in sidebar
async function renderThumbnails() {
    pagesList.innerHTML = '';
    
    for (let i = 1; i <= pdfDocInstance.numPages; i++) {
        const page = await pdfDocInstance.getPage(i);
        // Render at a small scale
        const viewport = page.getViewport({ scale: 0.15 });
        
        const container = document.createElement('div');
        container.className = 'page-thumbnail-container';
        if (i === currentPageNum) container.className += ' active';
        container.dataset.page = i;
        
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        
        const pageNumLabel = document.createElement('div');
        pageNumLabel.className = 'page-number';
        pageNumLabel.textContent = `Pagina ${i}`;
        
        container.appendChild(canvas);
        container.appendChild(pageNumLabel);
        
        container.addEventListener('click', () => {
            deselectElement();
            renderPage(i);
        });
        
        pagesList.appendChild(container);
    }
}

// Adjust Zoom
async function adjustZoom(delta) {
    const newZoom = Math.min(Math.max(currentZoom + delta, 0.5), 2.5);
    if (newZoom !== currentZoom) {
        currentZoom = newZoom;
        zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
        await renderPage(currentPageNum);
    }
}

// Set Active Tool
function setTool(tool) {
    currentTool = tool;
    
    // Update active toolbar UI
    toolSelect.classList.toggle('active', tool === 'select');
    toolWhiteout.classList.toggle('active', tool === 'whiteout');
    toolText.classList.toggle('active', tool === 'text');
    toolCutMove.classList.toggle('active', tool === 'cutmove');
    
    // Change cursor
    editingOverlay.className = '';
    if (tool === 'whiteout' || tool === 'cutmove') {
        editingOverlay.classList.add('crosshair-cursor');
    } else if (tool === 'text') {
        editingOverlay.classList.add('text-cursor');
    }
    
    deselectElement();
}

// --- RENDERING MODIFICATIONS ---

function renderModifications() {
    editingOverlay.innerHTML = '';
    const pageMods = modifications[currentPageNum] || [];
    
    pageMods.forEach(mod => {
        const el = document.createElement('div');
        el.className = `overlay-element ${mod.type === 'whiteout' ? 'whiteout-rect' : 'text-element'}`;
        el.dataset.id = mod.id;
        
        // Position relative to viewport size in percentages
        el.style.left = `${mod.x}%`;
        el.style.top = `${mod.y}%`;
        el.style.width = `${mod.width}%`;
        el.style.height = `${mod.height}%`;
        
        if (mod.type === 'whiteout') {
            el.style.backgroundColor = mod.color;
        } else if (mod.type === 'selector') {
            el.style.border = '2px dashed #0284c7';
            el.style.backgroundColor = 'rgba(14, 165, 233, 0.15)';
        } else if (mod.type === 'text') {
            el.style.color = mod.color;
            el.style.fontSize = `${mod.fontSize * currentZoom}px`;
            el.style.fontFamily = getCSSFontFamily(mod.fontFamily);
            el.innerText = mod.text;
        } else if (mod.type === 'image') {
            const img = document.createElement('img');
            img.src = mod.dataUrl;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.display = 'block';
            img.style.pointerEvents = 'none';
            el.appendChild(img);
        }
        
        // Highlight selection
        if (mod.id === selectedElementId) {
            el.classList.add('selected');
            
            // Add resize handle (only for whiteout or texts if we want to change dimensions)
            const handle = document.createElement('div');
            handle.className = 'resize-handle se';
            el.appendChild(handle);
            
            // Setup resize listener
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                startResize(e, mod);
            });
        }
        
        // Drag Listener (only in Select mode)
        el.addEventListener('mousedown', (e) => {
            if (currentTool !== 'select') return;
            e.stopPropagation();
            selectElement(mod.id);
            startDrag(e, mod);
        });
        
        editingOverlay.appendChild(el);
    });
}

function getCSSFontFamily(pdfFont) {
    if (pdfFont.startsWith('Helvetica')) return 'sans-serif';
    if (pdfFont.startsWith('Times')) return 'serif';
    if (pdfFont.startsWith('Courier')) return 'monospace';
    return 'sans-serif';
}

// --- SELECTION & PROPERTIES PANEL ---

function selectElement(id) {
    selectedElementId = id;
    const pageMods = modifications[currentPageNum] || [];
    const mod = pageMods.find(m => m.id === id);
    
    if (mod) {
        noSelectionMsg.style.display = 'none';
        propertiesControls.style.display = 'block';
        
        if (mod.type === 'text') {
            propTextGroup.style.display = 'flex';
            propWhiteoutGroup.style.display = 'none';
            
            propTextValue.value = mod.text;
            propFontSize.value = mod.fontSize;
            propFontFamily.value = mod.fontFamily;
            propTextColor.value = mod.color;
            propTextColorHex.textContent = mod.color.toUpperCase();
        } else if (mod.type === 'whiteout') {
            propTextGroup.style.display = 'none';
            propWhiteoutGroup.style.display = 'flex';
            
            propFillColor.value = mod.color;
            propFillColorHex.textContent = mod.color.toUpperCase();
        } else if (mod.type === 'image') {
            propTextGroup.style.display = 'none';
            propWhiteoutGroup.style.display = 'none';
        }
    }
    
    renderModifications();
}

function deselectElement() {
    selectedElementId = null;
    noSelectionMsg.style.display = 'block';
    propertiesControls.style.display = 'none';
    renderModifications();
}

function updateSelectedElement(field, value) {
    if (!selectedElementId) return;
    const pageMods = modifications[currentPageNum] || [];
    const mod = pageMods.find(m => m.id === selectedElementId);
    
    if (mod) {
        mod[field] = value;
        
        // Auto calculate visual bounding box for text when text changes
        if (mod.type === 'text' && (field === 'text' || field === 'fontSize' || field === 'fontFamily')) {
            // Rough size estimation based on characters and font size
            const lines = mod.text.split('\n');
            let maxCharCount = 0;
            lines.forEach(l => {
                if (l.length > maxCharCount) maxCharCount = l.length;
            });
            
            const estWidth = maxCharCount * (mod.fontSize * 0.6);
            const estHeight = lines.length * (mod.fontSize * 1.25);
            
            // Map pixel widths back to percentages based on current canvas dimension
            const overlayWidth = editingOverlay.clientWidth;
            const overlayHeight = editingOverlay.clientHeight;
            
            mod.width = (estWidth / overlayWidth) * 100;
            mod.height = (estHeight / overlayHeight) * 100;
        }
        
        renderModifications();
    }
}

function deleteSelectedElement() {
    if (!selectedElementId) return;
    saveHistory();
    let pageMods = modifications[currentPageNum] || [];
    modifications[currentPageNum] = pageMods.filter(m => m.id !== selectedElementId);
    deselectElement();
}

// --- INTERACTION: DRAWING, DRAGGING, RESIZING ---

// Overlay Drawing (For Whiteout and Text insertion)
editingOverlay.addEventListener('mousedown', async (e) => {
    if (e.target !== editingOverlay) return;
    
    const rect = editingOverlay.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    
    if (currentTool === 'whiteout') {
        saveHistory();
        isDrawing = true;
        startDrawX = xPct;
        startDrawY = yPct;
        
        const id = Date.now().toString();
        const newMod = {
            id: id,
            type: 'whiteout',
            x: xPct,
            y: yPct,
            width: 0.1,
            height: 0.1,
            color: '#ffffff'
        };
        
        modifications[currentPageNum].push(newMod);
        selectedElementId = id;
        renderModifications();
        
        drawElement = modifications[currentPageNum].find(m => m.id === id);
    } else if (currentTool === 'cutmove') {
        saveHistory();
        isDrawing = true;
        startDrawX = xPct;
        startDrawY = yPct;
        
        const id = 'temp_selector';
        const newMod = {
            id: id,
            type: 'selector',
            x: xPct,
            y: yPct,
            width: 0.1,
            height: 0.1
        };
        
        modifications[currentPageNum].push(newMod);
        renderModifications();
        
        drawElement = modifications[currentPageNum].find(m => m.id === id);
    } else if (currentTool === 'text') {
        saveHistory();
        
        // Match closest PDF text properties
        let detectedFontSize = 14;
        let detectedFontFamily = 'Helvetica';
        
        try {
            const page = await pdfDocInstance.getPage(currentPageNum);
            const viewport = page.getViewport({ scale: 1.0 });
            const pdfWidth = viewport.width;
            const pdfHeight = viewport.height;
            
            // Map click coords to PDF coordinates
            const clickX = (xPct / 100) * pdfWidth;
            const clickY = (1 - (yPct / 100)) * pdfHeight;
            
            const textContent = await page.getTextContent();
            let minDistance = Infinity;
            let nearestItem = null;
            
            textContent.items.forEach(item => {
                const tx = item.transform[4];
                const ty = item.transform[5];
                const dist = Math.sqrt(Math.pow(tx - clickX, 2) + Math.pow(ty - clickY, 2));
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestItem = item;
                }
            });
            
            // If nearest text item is within range (100pt ~ 1.3 inches)
            if (nearestItem && minDistance < 100) {
                const sizePt = Math.abs(nearestItem.transform[3] || nearestItem.transform[0] || 10);
                detectedFontSize = Math.round(sizePt * (96 / 72)); // pt to px conversion
                if (detectedFontSize < 8) detectedFontSize = 8;
                if (detectedFontSize > 72) detectedFontSize = 72;
                
                const fname = (nearestItem.fontName || '').toLowerCase();
                const isBold = fname.includes('bold') || fname.includes('goth') || fname.includes('heavy') || fname.includes('black');
                const isSerif = fname.includes('times') || fname.includes('roman') || fname.includes('georgia') || fname.includes('serif');
                const isMono = fname.includes('courier') || fname.includes('mono') || fname.includes('code');
                
                if (isSerif) {
                    detectedFontFamily = isBold ? 'Times-Bold' : 'Times-Roman';
                } else if (isMono) {
                    detectedFontFamily = isBold ? 'Courier-Bold' : 'Courier';
                } else {
                    detectedFontFamily = isBold ? 'Helvetica-Bold' : 'Helvetica';
                }
            }
        } catch (err) {
            console.error("Errore nel rilevamento intelligente del font: ", err);
        }

        const id = Date.now().toString();
        const newMod = {
            id: id,
            type: 'text',
            x: xPct,
            y: yPct,
            width: 20, // default placeholder dimensions
            height: 5,
            text: 'Nuovo Testo',
            fontSize: detectedFontSize,
            fontFamily: detectedFontFamily,
            color: '#000000'
        };
        
        modifications[currentPageNum].push(newMod);
        selectElement(id);
        
        // Auto focus the properties panel text inputs to let them edit it
        propTextValue.focus();
        propTextValue.select();
        
        // Reset tool to select so they can move the text box around easily
        setTool('select');
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isDrawing || !drawElement) return;
    
    const rect = editingOverlay.getBoundingClientRect();
    const currentXPct = ((e.clientX - rect.left) / rect.width) * 100;
    const currentYPct = ((e.clientY - rect.top) / rect.height) * 100;
    
    const left = Math.min(startDrawX, currentXPct);
    const top = Math.min(startDrawY, currentYPct);
    const width = Math.max(0.1, Math.abs(currentXPct - startDrawX));
    const height = Math.max(0.1, Math.abs(currentYPct - startDrawY));
    
    drawElement.x = left;
    drawElement.y = top;
    drawElement.width = width;
    drawElement.height = height;
    
    renderModifications();
});

window.addEventListener('mouseup', async () => {
    if (isDrawing) {
        isDrawing = false;
        
        if (currentTool === 'cutmove' && drawElement) {
            // Remove selector box
            modifications[currentPageNum] = modifications[currentPageNum].filter(m => m.id !== 'temp_selector');
            
            // Crop selection as an image and create mods
            await cropAndCutAsImage(drawElement);
        }
        
        drawElement = null;
        setTool('select'); // Automatically revert to selection
    }
});

// Dragging Logic
function startDrag(e, mod) {
    const rect = editingOverlay.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialXPct = mod.x;
    const initialYPct = mod.y;
    
    function onMouseMove(moveEvent) {
        const deltaX = ((moveEvent.clientX - startX) / rect.width) * 100;
        const deltaY = ((moveEvent.clientY - startY) / rect.height) * 100;
        
        // Constrain coordinates within page boundaries (0 to 100)
        mod.x = Math.min(Math.max(initialXPct + deltaX, 0), 100 - mod.width);
        mod.y = Math.min(Math.max(initialYPct + deltaY, 0), 100 - mod.height);
        
        renderModifications();
    }
    
    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }
    
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

// Resizing Logic
function startResize(e, mod) {
    const rect = editingOverlay.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialWidthPct = mod.width;
    const initialHeightPct = mod.height;
    
    function onMouseMove(moveEvent) {
        const deltaX = ((moveEvent.clientX - startX) / rect.width) * 100;
        const deltaY = ((moveEvent.clientY - startY) / rect.height) * 100;
        
        mod.width = Math.min(Math.max(initialWidthPct + deltaX, 0.5), 100 - mod.x);
        mod.height = Math.min(Math.max(initialHeightPct + deltaY, 0.5), 100 - mod.y);
        
        renderModifications();
    }
    
    function onMouseUp() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    }
    
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}

// --- EXPORT PDF GENERATION ---

// Convert hex string (#ffffff) to RGB floats [0..1]
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
}

async function exportPDF() {
    if (!pdfBytes) return;
    
    exportBtn.disabled = true;
    exportBtn.innerText = 'Esportazione...';
    
    try {
        const { PDFDocument, rgb } = PDFLib;
        const rgbFn = rgb || window.rgb;
        
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        
        for (let i = 0; i < pages.length; i++) {
            const pageNum = i + 1;
            const pageMods = modifications[pageNum] || [];
            if (pageMods.length === 0) continue;
            
            const page = pages[i];
            const { width, height } = page.getSize();
            
            for (const mod of pageMods) {
                // Map percentages back to PDF units (relative to bottom-left)
                const x = (mod.x / 100) * width;
                const y = (1 - (mod.y / 100)) * height; // Invert Y axis
                const w = (mod.width / 100) * width;
                const h = (mod.height / 100) * height;
                
                if (mod.type === 'whiteout') {
                    const rgbVal = hexToRgb(mod.color);
                    page.drawRectangle({
                        x: x,
                        y: y - h, // Translate top-left HTML position to bottom-left PDF position
                        width: w,
                        height: h,
                        color: rgbFn(rgbVal.r, rgbVal.g, rgbVal.b),
                    });
                } else if (mod.type === 'text') {
                    const rgbVal = hexToRgb(mod.color);
                    
                    // Embed standard font using direct string names for maximum compatibility
                    let fontName = 'Helvetica';
                    if (mod.fontFamily === 'Helvetica') fontName = 'Helvetica';
                    else if (mod.fontFamily === 'Helvetica-Bold') fontName = 'Helvetica-Bold';
                    else if (mod.fontFamily === 'Times-Roman') fontName = 'Times-Roman';
                    else if (mod.fontFamily === 'Times-Bold') fontName = 'Times-Bold';
                    else if (mod.fontFamily === 'Courier') fontName = 'Courier';
                    else if (mod.fontFamily === 'Courier-Bold') fontName = 'Courier-Bold';
                    
                    const font = await pdfDoc.embedFont(fontName);
                    
                    // Draw each line with spacing adjustment
                    const lines = mod.text.split('\n');
                    const fontSizePDF = (mod.fontSize / 96) * 72; // Convert HTML pixel font-size to standard PDF points (96 DPI screen vs 72 DPI PDF)
                    const lineSpacing = fontSizePDF * 1.25;
                    
                    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                        // Drawing line
                        page.drawText(lines[lineIndex], {
                            x: x,
                            y: y - fontSizePDF - (lineIndex * lineSpacing),
                            size: fontSizePDF,
                            font: font,
                            color: rgbFn(rgbVal.r, rgbVal.g, rgbVal.b),
                        });
                    }
                } else if (mod.type === 'image') {
                    // Embed PNG image
                    const imageBytes = dataUrlToUint8Array(mod.dataUrl);
                    const embeddedImage = await pdfDoc.embedPng(imageBytes);
                    
                    page.drawImage(embeddedImage, {
                        x: x,
                        y: y - h,
                        width: w,
                        height: h
                    });
                }
            }
        }
        
        // Save modified PDF
        const modifiedPdfBytes = await pdfDoc.save();
        
        // Download browser trigger
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        // Set filename suffix
        const originalName = documentName.textContent;
        const extensionIdx = originalName.lastIndexOf('.');
        const newName = extensionIdx !== -1 
            ? `${originalName.substring(0, extensionIdx)}_modificato.pdf`
            : `${originalName}_modificato.pdf`;
            
        link.href = url;
        link.download = newName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Errore nell\'esportazione del PDF: ', error);
        alert('Errore di esportazione:\n' + error.message + '\n\nDettagli:\n' + error.stack);
    } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = '<span>💾</span> Salva / Esporta';
    }
}

// --- CROP AND CUT AS IMAGE ---
function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function cropAndCutAsImage(selectorMod) {
    if (!pdfDocInstance) return;
    
    try {
        const x1 = selectorMod.x;
        const y1 = selectorMod.y;
        const w = selectorMod.width;
        const h = selectorMod.height;
        
        // Pixel coordinates on the rendered canvas
        const sourceX = (x1 / 100) * pdfCanvas.width;
        const sourceY = (y1 / 100) * pdfCanvas.height;
        const sourceW = (w / 100) * pdfCanvas.width;
        const sourceH = (h / 100) * pdfCanvas.height;
        
        if (sourceW < 2 || sourceH < 2) return;
        
        // Crop the region from pdfCanvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sourceW;
        tempCanvas.height = sourceH;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(pdfCanvas, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
        
        const dataUrl = tempCanvas.toDataURL('image/png');
        
        // 1. Create a whiteout block to hide the original text
        const whiteoutId = 'wo_' + Date.now();
        const newWhiteout = {
            id: whiteoutId,
            type: 'whiteout',
            x: x1,
            y: y1,
            width: w,
            height: h,
            color: '#ffffff'
        };
        
        // 2. Create the draggable Image block
        const imageId = 'img_' + Date.now();
        const newImage = {
            id: imageId,
            type: 'image',
            x: x1,
            y: y1,
            width: w,
            height: h,
            dataUrl: dataUrl
        };
        
        modifications[currentPageNum].push(newWhiteout);
        modifications[currentPageNum].push(newImage);
        
        // Select the image block for dragging/moving
        selectElement(imageId);
        
    } catch (err) {
        console.error("Errore durante il ritaglio dell'immagine: ", err);
        alert("Impossibile tagliare l'area selezionata: " + err.message);
    }
}

// --- UNDO HISTORY MANAGEMENT ---
let historyStack = [];
const maxHistoryStates = 30;

function saveHistory() {
    const stateCopy = JSON.parse(JSON.stringify(modifications));
    historyStack.push(stateCopy);
    if (historyStack.length > maxHistoryStates) {
        historyStack.shift();
    }
    updateUndoButtonState();
}

function updateUndoButtonState() {
    if (undoBtn) {
        undoBtn.disabled = historyStack.length === 0;
    }
}

function undo() {
    if (historyStack.length === 0) return;
    
    const previousState = historyStack.pop();
    modifications = previousState;
    
    selectedElementId = null;
    deselectElement();
    renderModifications();
    updateUndoButtonState();
}

// --- TAB SWITCHING & ADDITIONAL PDF TOOLS (MERGE / SPLIT) ---

const tabEdit = document.getElementById('tabEdit');
const tabMerge = document.getElementById('tabMerge');
const tabSplit = document.getElementById('tabSplit');
const tabConvert = document.getElementById('tabConvert');
const panelEdit = document.getElementById('panelEdit');
const panelMerge = document.getElementById('panelMerge');
const panelSplit = document.getElementById('panelSplit');
const panelConvert = document.getElementById('panelConvert');

function switchTab(tab) {
    tabEdit.classList.toggle('active', tab === 'edit');
    tabMerge.classList.toggle('active', tab === 'merge');
    tabSplit.classList.toggle('active', tab === 'split');
    tabConvert.classList.toggle('active', tab === 'convert');
    
    panelEdit.style.display = tab === 'edit' ? 'flex' : 'none';
    panelMerge.style.display = tab === 'merge' ? 'flex' : 'none';
    panelSplit.style.display = tab === 'split' ? 'flex' : 'none';
    panelConvert.style.display = tab === 'convert' ? 'flex' : 'none';
    
    // When switching to Convert, if a PDF is already loaded, pre-select it
    if (tab === 'convert' && pdfBytes && pdfDocInstance) {
        document.getElementById('convertFileName').textContent = documentName.textContent;
        document.getElementById('startConvertBtn').disabled = false;
        convertPdfBytes = pdfBytes;
        convertPdfDoc = pdfDocInstance;
    }
}

tabEdit.addEventListener('click', () => switchTab('edit'));
tabMerge.addEventListener('click', () => switchTab('merge'));
tabSplit.addEventListener('click', () => switchTab('split'));
tabConvert.addEventListener('click', () => switchTab('convert'));

// --- MERGE LOGIC ---
let mergeFiles = [];
const mergeFileInput = document.getElementById('mergeFileInput');
const mergeUploadZone = document.getElementById('mergeUploadZone');
const mergeList = document.getElementById('mergeList');
const startMergeBtn = document.getElementById('startMergeBtn');

mergeUploadZone.addEventListener('click', () => mergeFileInput.click());
mergeFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        for (const file of e.target.files) {
            if (file.type === 'application/pdf') {
                mergeFiles.push(file);
            }
        }
        renderMergeQueue();
    }
});

function renderMergeQueue() {
    if (mergeFiles.length === 0) {
        mergeList.innerHTML = '<p class="empty-list-msg">Nessun file aggiunto per l\'unione.</p>';
        startMergeBtn.disabled = true;
        return;
    }
    
    mergeList.innerHTML = '';
    startMergeBtn.disabled = mergeFiles.length < 2; // Need at least 2 files
    
    mergeFiles.forEach((file, index) => {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        const el = document.createElement('div');
        el.className = 'merge-item';
        el.innerHTML = `
            <div class="merge-item-info">
                <span class="merge-item-name" title="${file.name}">${file.name}</span>
                <span class="merge-item-size">${sizeMb} MB</span>
            </div>
            <div class="merge-item-actions">
                <button class="merge-action-btn move-up" title="Sposta su" ${index === 0 ? 'disabled' : ''}>▲</button>
                <button class="merge-action-btn move-down" title="Sposta giù" ${index === mergeFiles.length - 1 ? 'disabled' : ''}>▼</button>
                <button class="merge-action-btn delete" title="Rimuovi">🗑️</button>
            </div>
        `;
        
        el.querySelector('.move-up').addEventListener('click', () => {
            const temp = mergeFiles[index];
            mergeFiles[index] = mergeFiles[index - 1];
            mergeFiles[index - 1] = temp;
            renderMergeQueue();
        });
        
        el.querySelector('.move-down').addEventListener('click', () => {
            const temp = mergeFiles[index];
            mergeFiles[index] = mergeFiles[index + 1];
            mergeFiles[index + 1] = temp;
            renderMergeQueue();
        });
        
        el.querySelector('.delete').addEventListener('click', () => {
            mergeFiles.splice(index, 1);
            renderMergeQueue();
        });
        
        mergeList.appendChild(el);
    });
}

mergeUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    mergeUploadZone.style.borderColor = 'var(--accent)';
    mergeUploadZone.style.background = 'rgba(99, 102, 241, 0.12)';
});

mergeUploadZone.addEventListener('dragleave', () => {
    mergeUploadZone.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    mergeUploadZone.style.background = 'rgba(99, 102, 241, 0.04)';
});

mergeUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    mergeUploadZone.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    mergeUploadZone.style.background = 'rgba(99, 102, 241, 0.04)';
    if (e.dataTransfer.files.length > 0) {
        for (const file of e.dataTransfer.files) {
            if (file.type === 'application/pdf') {
                mergeFiles.push(file);
            }
        }
        renderMergeQueue();
    }
});

startMergeBtn.addEventListener('click', async () => {
    if (mergeFiles.length < 2) return;
    startMergeBtn.disabled = true;
    startMergeBtn.innerText = 'Unione in corso...';
    
    try {
        const mergedPdf = await PDFLib.PDFDocument.create();
        for (const file of mergeFiles) {
            const fileBytes = await file.arrayBuffer();
            const pdf = await PDFLib.PDFDocument.load(fileBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
        
        const mergedPdfBytes = await mergedPdf.save();
        const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'documento_unito.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        alert('Documenti uniti con successo!');
    } catch (err) {
        console.error("Errore durante l'unione dei PDF: ", err);
        alert("Impossibile unire i PDF: " + err.message);
    } finally {
        startMergeBtn.disabled = false;
        startMergeBtn.innerText = '🔗 Unisci PDF';
    }
});

// --- SPLIT LOGIC ---
const startSplitBtn = document.getElementById('startSplitBtn');
const splitRangeInput = document.getElementById('splitRangeInput');

startSplitBtn.addEventListener('click', async () => {
    if (!pdfBytes || !pdfDocInstance) {
        alert('Per favore, carica prima un file PDF nella scheda Modifica.');
        return;
    }
    
    const rangeStr = splitRangeInput.value.trim();
    if (!rangeStr) {
        alert('Per favore, specifica le pagine da estrarre (es. 1-3, 5).');
        return;
    }
    
    startSplitBtn.disabled = true;
    startSplitBtn.innerText = 'Divisione in corso...';
    
    try {
        const totalPages = pdfDocInstance.numPages;
        const pagesToExtract = parseRanges(rangeStr, totalPages);
        
        if (pagesToExtract.length === 0) {
            alert('Nessuna pagina valida trovata per l\'intervallo specificato. Controlla i numeri di pagina inseriti.');
            return;
        }
        
        const splitPdf = await PDFLib.PDFDocument.create();
        const pdf = await PDFLib.PDFDocument.load(pdfBytes);
        const copiedPages = await splitPdf.copyPages(pdf, pagesToExtract);
        copiedPages.forEach((page) => splitPdf.addPage(page));
        
        const splitPdfBytes = await splitPdf.save();
        const blob = new Blob([splitPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        const originalName = documentName.textContent;
        const extensionIdx = originalName.lastIndexOf('.');
        const newName = extensionIdx !== -1 
            ? `${originalName.substring(0, extensionIdx)}_diviso.pdf`
            : `${originalName}_diviso.pdf`;
            
        link.href = url;
        link.download = newName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        alert('Documento diviso ed estratto con successo!');
    } catch (err) {
        console.error("Errore durante la divisione del PDF: ", err);
        alert("Impossibile dividere il PDF: " + err.message);
    } finally {
        startSplitBtn.disabled = false;
        startSplitBtn.innerText = '✂️ Dividi PDF';
    }
});

function parseRanges(rangeStr, maxPages) {
    const pages = [];
    const parts = rangeStr.split(',');
    for (let part of parts) {
        part = part.trim();
        if (part.includes('-')) {
            const [startStr, endStr] = part.split('-');
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            if (!isNaN(start) && !isNaN(end)) {
                const s = Math.min(start, end);
                const e = Math.max(start, end);
                for (let i = s; i <= e; i++) {
                    if (i >= 1 && i <= maxPages) {
                        pages.push(i - 1); // convert to 0-index
                    }
                }
            }
        } else {
            const pageNum = parseInt(part, 10);
            if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= maxPages) {
                pages.push(pageNum - 1); // convert to 0-index
            }
        }
    }
    // Remove duplicates and sort
    return [...new Set(pages)].sort((a, b) => a - b);
}

// --- PDF TO WORD CONVERSION ---
let convertPdfBytes = null;
let convertPdfDoc = null;

const convertUploadZone = document.getElementById('convertUploadZone');
const convertFileInput = document.getElementById('convertFileInput');
const convertFileName = document.getElementById('convertFileName');
const startConvertBtn = document.getElementById('startConvertBtn');
const convertProgress = document.getElementById('convertProgress');
const convertProgressBar = document.getElementById('convertProgressBar');
const convertProgressText = document.getElementById('convertProgressText');

convertUploadZone.addEventListener('click', () => convertFileInput.click());

convertUploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    convertUploadZone.style.borderColor = 'var(--accent)';
    convertUploadZone.style.background = 'rgba(99, 102, 241, 0.12)';
});

convertUploadZone.addEventListener('dragleave', () => {
    convertUploadZone.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    convertUploadZone.style.background = 'rgba(99, 102, 241, 0.04)';
});

convertUploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    convertUploadZone.style.borderColor = 'rgba(99, 102, 241, 0.4)';
    convertUploadZone.style.background = 'rgba(99, 102, 241, 0.04)';
    if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].type === 'application/pdf') {
        loadConvertFile(e.dataTransfer.files[0]);
    }
});

convertFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadConvertFile(e.target.files[0]);
    }
});

function loadConvertFile(file) {
    const reader = new FileReader();
    reader.onload = async function() {
        convertPdfBytes = new Uint8Array(this.result);
        try {
            const dataCopy = convertPdfBytes.slice(0);
            convertPdfDoc = await pdfjsLib.getDocument({ data: dataCopy }).promise;
            convertFileName.textContent = file.name + ' (' + convertPdfDoc.numPages + ' pagine)';
            convertFileName.style.color = 'var(--text-main)';
            convertFileName.style.fontStyle = 'normal';
            startConvertBtn.disabled = false;
        } catch (err) {
            alert('Impossibile caricare il PDF per la conversione: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

startConvertBtn.addEventListener('click', async () => {
    if (!convertPdfDoc || !convertPdfBytes) {
        alert('Carica prima un file PDF da convertire.');
        return;
    }

    const includeImages   = document.getElementById('convertIncludeImages').checked;
    const includeText     = document.getElementById('convertIncludeText').checked;
    const includePageNums = document.getElementById('convertPageNumbers').checked;
    const imageScale      = parseFloat(document.getElementById('convertImageQuality').value);

    if (!includeImages && !includeText) {
        alert('Seleziona almeno una opzione: testo o immagini.');
        return;
    }

    startConvertBtn.disabled = true;
    convertProgress.style.display = 'block';

    try {
        const totalPages = convertPdfDoc.numPages;
        let bodyHtml = '';

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const pct = Math.round(((pageNum - 1) / totalPages) * 100);
            convertProgressBar.style.width = pct + '%';
            convertProgressText.textContent = `Elaborazione pagina ${pageNum} di ${totalPages}...`;

            // Small delay to let the browser repaint the progress bar
            await new Promise(r => setTimeout(r, 0));

            const page = await convertPdfDoc.getPage(pageNum);

            // ----- Page separator -----
            if (pageNum > 1) {
                bodyHtml += '<div style="page-break-before:always;"></div>';
            }

            if (includePageNums && totalPages > 1) {
                bodyHtml += `<p style="text-align:center;color:#888;font-family:Arial;font-size:11pt;margin:6pt 0;">
                    ─── Pagina ${pageNum} di ${totalPages} ───
                </p>`;
            }

            // ----- Page image -----
            if (includeImages) {
                const viewport = page.getViewport({ scale: imageScale });
                const offCanvas = document.createElement('canvas');
                offCanvas.width  = viewport.width;
                offCanvas.height = viewport.height;
                const ctx = offCanvas.getContext('2d');
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;

                const dataUrl = offCanvas.toDataURL('image/png');
                // Max width 16cm to fit inside A4 margins
                bodyHtml += `<p style="text-align:center;margin:6pt 0;">
                    <img src="${dataUrl}" style="max-width:16cm;height:auto;display:block;margin:0 auto;" />
                </p>`;
            }

            // ----- Extracted text -----
            if (includeText) {
                const textContent = await page.getTextContent();

                if (textContent.items.length > 0) {
                    if (includeImages) {
                        bodyHtml += `<p style="font-family:Arial;font-size:9pt;color:#555;margin:12pt 0 4pt;">
                            <strong>Testo estratto:</strong>
                        </p>`;
                    }

                    // Sort items top→bottom, left→right
                    const sorted = [...textContent.items].sort((a, b) => {
                        const dy = b.transform[5] - a.transform[5];
                        if (Math.abs(dy) > 5) return dy;
                        return a.transform[4] - b.transform[4];
                    });

                    // Group into lines
                    const lines = [];
                    let curLine = [];
                    let lastY = null;
                    sorted.forEach(item => {
                        const y = item.transform[5];
                        if (lastY === null || Math.abs(y - lastY) > 5) {
                            if (curLine.length > 0) lines.push(curLine);
                            curLine = [item];
                        } else {
                            curLine.push(item);
                        }
                        lastY = y;
                    });
                    if (curLine.length > 0) lines.push(curLine);

                    lines.forEach(line => {
                        const txt = line.map(i => i.str).join(' ').trim();
                        if (!txt) return;
                        const fontSize = Math.abs(line[0].transform[3] || line[0].transform[0] || 10);
                        const ptSize   = Math.max(7, Math.min(Math.round(fontSize), 36));
                        bodyHtml += `<p style="font-family:Arial;font-size:${ptSize}pt;margin:1pt 0;line-height:1.3;">${escapeHtml(txt)}</p>`;
                    });
                }
            }
        }

        convertProgressBar.style.width = '100%';
        convertProgressText.textContent = 'Generazione del file Word...';
        await new Promise(r => setTimeout(r, 0));

        // Build a Word-compatible HTML document (MHT-style HTML Word format)
        const wordHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<meta name=ProgId content=Word.Document>
<meta name=Generator content="PDF EditPro">
<style>
  body { font-family: Arial, sans-serif; margin: 2cm; }
  img  { max-width: 100%; }
  p    { margin: 0; padding: 0; }
</style>
<!--[if gte mso 9]>
<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom></w:WordDocument></xml>
<![endif]-->
</head>
<body>${bodyHtml}</body>
</html>`;

        // Download as .doc (Word opens this HTML format natively)
        const blob = new Blob([wordHtml], { type: 'application/msword;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const baseName = convertFileName.textContent.split(' (')[0].replace(/\.pdf$/i, '');
        link.href     = url;
        link.download = baseName + '_convertito.doc';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        convertProgressText.textContent = '✅ Conversione completata! File scaricato.';
        convertProgressBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';

    } catch (err) {
        console.error('Errore conversione PDF → Word:', err);
        alert('Errore durante la conversione:\n' + err.message);
    } finally {
        startConvertBtn.disabled = false;
        setTimeout(() => {
            convertProgress.style.display = 'none';
            convertProgressBar.style.width = '0%';
            convertProgressBar.style.background = 'linear-gradient(90deg, var(--accent), #7c3aed)';
            convertProgressText.textContent = 'Conversione in corso...';
        }, 4000);
    }
});

// Utility: escape HTML special characters for text content
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}


    startConvertBtn.disabled = true;
    convertProgress.style.display = 'block';

    try {
        const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, PageBreak } = docx;
        const totalPages = convertPdfDoc.numPages;
        const children = [];

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            // Update progress bar
            const pct = Math.round(((pageNum - 1) / totalPages) * 100);
            convertProgressBar.style.width = pct + '%';
            convertProgressText.textContent = `Elaborazione pagina ${pageNum} di ${totalPages}...`;

            const page = await convertPdfDoc.getPage(pageNum);

            // --- Page Number Heading ---
            if (includePageNumbers && totalPages > 1) {
                children.push(new Paragraph({
                    children: [new TextRun({
                        text: `─── Pagina ${pageNum} ───`,
                        bold: true,
                        color: '888888',
                        size: 20
                    })],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 100 }
                }));
            }

            // --- Image of the page ---
            if (includeImages) {
                const viewport = page.getViewport({ scale: imageScale });
                const offscreenCanvas = document.createElement('canvas');
                offscreenCanvas.width = viewport.width;
                offscreenCanvas.height = viewport.height;
                const ctx = offscreenCanvas.getContext('2d');
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;

                const dataUrl = offscreenCanvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

                // Scale to max ~15cm wide in Word (in EMUs: 1cm = 360000 EMU)
                const maxWidthEMU = 8600000; // ~23.9cm (letter width minus margins)
                const aspectRatio = viewport.height / viewport.width;
                const widthEMU = maxWidthEMU;
                const heightEMU = Math.round(widthEMU * aspectRatio);

                children.push(new Paragraph({
                    children: [new ImageRun({
                        data: imgBytes,
                        transformation: { width: Math.round(widthEMU / 9144), height: Math.round(heightEMU / 9144) },
                        type: 'png'
                    })],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 100, after: 100 }
                }));
            }

            // --- Extracted Text ---
            if (includeText) {
                const textContent = await page.getTextContent();
                const viewport1 = page.getViewport({ scale: 1.0 });
                const pageH = viewport1.height;

                if (textContent.items.length > 0) {
                    // Group items into lines by Y position
                    const lines = [];
                    let currentLine = [];
                    let lastY = null;

                    // Sort items top to bottom (PDF Y is bottom-up so sort by desc Y)
                    const sorted = [...textContent.items].sort((a, b) => {
                        const yDiff = b.transform[5] - a.transform[5];
                        if (Math.abs(yDiff) > 5) return yDiff;
                        return a.transform[4] - b.transform[4];
                    });

                    sorted.forEach(item => {
                        const y = item.transform[5];
                        if (lastY === null || Math.abs(y - lastY) > 5) {
                            if (currentLine.length > 0) lines.push(currentLine);
                            currentLine = [item];
                        } else {
                            currentLine.push(item);
                        }
                        lastY = y;
                    });
                    if (currentLine.length > 0) lines.push(currentLine);

                    if (includeImages) {
                        // Add a heading for the text section
                        children.push(new Paragraph({
                            children: [new TextRun({ text: 'Testo estratto:', bold: true, size: 18, color: '555555' })],
                            spacing: { before: 120, after: 80 }
                        }));
                    }

                    lines.forEach(line => {
                        const lineText = line.map(i => i.str).join(' ').trim();
                        if (!lineText) return;

                        // Estimate font size from transform matrix
                        const fontSize = Math.abs(line[0].transform[3] || line[0].transform[0] || 10);
                        const sizeHalfPt = Math.round(fontSize * 2); // docx size is in half-points

                        children.push(new Paragraph({
                            children: [new TextRun({
                                text: lineText,
                                size: Math.max(14, Math.min(sizeHalfPt, 72))
                            })],
                            spacing: { before: 0, after: 40 }
                        }));
                    });
                }
            }

            // Page break between pages (except last)
            if (pageNum < totalPages) {
                children.push(new Paragraph({
                    children: [new PageBreak()],
                }));
            }
        }

        convertProgressBar.style.width = '100%';
        convertProgressText.textContent = 'Generazione del file Word...';

        const doc = new Document({
            sections: [{
                properties: {},
                children: children
            }]
        });

        // Generate and download
        const blob = await Packer.toBlob(doc);
        const originalName = convertFileName.textContent.split(' (')[0];
        const wordName = originalName.replace(/\.pdf$/i, '') + '_convertito.docx';
        saveAs(blob, wordName);

        convertProgressText.textContent = '✅ Conversione completata! File scaricato.';
        convertProgressBar.style.background = 'linear-gradient(90deg, var(--success), #059669)';

    } catch (err) {
        console.error('Errore conversione PDF to Word:', err);
        alert('Errore durante la conversione:\n' + err.message);
    } finally {
        startConvertBtn.disabled = false;
        setTimeout(() => {
            convertProgress.style.display = 'none';
            convertProgressBar.style.width = '0%';
            convertProgressBar.style.background = 'linear-gradient(90deg, var(--accent), #7c3aed)';
            convertProgressText.textContent = 'Conversione in corso...';
        }, 4000);
    }
});
