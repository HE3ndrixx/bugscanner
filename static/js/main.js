document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('scanForm');
    const modeSelect = document.getElementById('mode');
    const proxyGroup = document.getElementById('proxyGroup');
    const cmdPreview = document.getElementById('cmdPreview');
    const termOutput = document.getElementById('termOutput');
    const btnScan = document.getElementById('btnScan');
    const btnCancel = document.getElementById('btnCancel');
    const btnDownload = document.getElementById('btnDownload');

    let eventSource = null;

    // Toggle Proxy Field based on mode
    modeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'proxy') {
            proxyGroup.style.display = 'block';
            // Add slight animation
            proxyGroup.style.animation = 'none';
            proxyGroup.offsetHeight; // trigger reflow
            proxyGroup.style.animation = 'slideIn 0.3s ease-out forwards';
        } else {
            proxyGroup.style.display = 'none';
        }
        updateCommandPreview();
    });

    // File Upload Handler for Targets
    const fileUpload = document.getElementById('fileUpload');
    const targetArea = document.getElementById('target');

    if (fileUpload && targetArea) {
        fileUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result.trim();
                if (!content) return;

                const currentVal = targetArea.value.trim();
                if (currentVal) {
                    targetArea.value = currentVal + '\n' + content;
                } else {
                    targetArea.value = content;
                }
                updateCommandPreview();
            };
            reader.readAsText(file);
            // reset input so the same file can be selected again
            fileUpload.value = '';
        });
    }

    // Update Command Preview on input change
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', updateCommandPreview);
    });

    function updateCommandPreview() {
        const target = document.getElementById('target').value.trim().split('\n').join(',');
        const mode = document.getElementById('mode').value;
        const ports = document.getElementById('ports').value.trim();
        const threads = document.getElementById('threads').value;
        const method = document.getElementById('method').value.trim();
        const proxy = document.getElementById('proxy').value.trim();

        let cmd = `python3 scanner.py -m ${mode} -p ${ports} -T ${threads} -M ${method}`;

        if (proxy && mode === 'proxy') {
            cmd += ` -P ${proxy}`;
        }

        if (target.includes('/')) {
            cmd += ` -c ${target}`;
        } else if (target) {
            cmd += ` -f targets.txt`; // Simplification for UI
        }

        cmdPreview.textContent = cmd;
    }

    // Initial command preview update
    updateCommandPreview();


    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function ansiToHtml(text) {
        let html = escapeHtml(text);

        const ansiMap = {
            '30': 'color: #000000;', // Black
            '31': 'color: #ff5f56;', // Red
            '32': 'color: #2ea043;', // Green
            '33': 'color: #ffbd2e;', // Yellow
            '34': 'color: #58a6ff;', // Blue
            '35': 'color: #bc8cff;', // Magenta
            '36': 'color: #39c5bb;', // Cyan
            '37': 'color: #e6edf3;', // White
            '90': 'color: #8b949e;', // Bright Black / Gray
            '91': 'color: #ff7b72;', // Bright Red
            '92': 'color: #3fb950;', // Bright Green
            '93': 'color: #d29922;', // Bright Yellow
            '94': 'color: #79c0ff;', // Bright Blue
            '95': 'color: #d2a8ff;', // Bright Magenta
            '96': 'color: #56d4dd;', // Bright Cyan
            '97': 'color: #ffffff;', // Bright White
            '0': '' // Reset
        };

        let openSpan = false;
        html = html.replace(/\x1B\[([0-9;]*)([mK])/g, (match, codes, command) => {
            if (command === 'K') return '';
            if (codes === '0' || codes === '') {
                if (openSpan) {
                    openSpan = false;
                    return '</span>';
                }
                return '';
            }

            const styles = codes.split(';').map(code => ansiMap[code]).join(' ');

            let res = '';
            if (openSpan) {
                res += '</span>';
            }
            res += `<span style="${styles}">`;
            openSpan = true;
            return res;
        });

        if (openSpan) {
            html += '</span>';
        }

        return html;
    }

    // Helper to append lines to console
    function appendTerminal(text, type = 'normal') {
        const div = document.createElement('div');
        div.className = `term-line ${type}`;

        if (type === 'normal') {
            div.innerHTML = ansiToHtml(text);
        } else {
            div.textContent = text;
        }

        termOutput.appendChild(div);

        // Auto scroll
        termOutput.scrollTop = termOutput.scrollHeight;
    }

    // Form Submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (eventSource) {
            eventSource.close();
        }

        // UI State
        btnScan.classList.add('scanning');
        btnScan.disabled = true;
        btnCancel.style.display = 'block';

        const formData = {
            target: document.getElementById('target').value.trim(),
            mode: document.getElementById('mode').value,
            ports: document.getElementById('ports').value.trim(),
            threads: document.getElementById('threads').value,
            method: document.getElementById('method').value.trim(),
            proxy: document.getElementById('proxy').value.trim()
        };

        termOutput.innerHTML = '';
        appendTerminal('Initializing scan sequence...', 'scan-info');

        try {
            // First, post the parameters to start the scan and get the SSE stream URL/response
            const response = await fetch('/scan', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Since fetch doesn't natively support SSE streams easily without manually polling chunks,
            // we will read the response stream chunks
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');

            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process lines from SSE format: `data: {"type": ..., "text": ...}\n\n`
                let doubleNewlineIndex;
                while ((doubleNewlineIndex = buffer.indexOf('\n\n')) >= 0) {
                    const chunk = buffer.slice(0, doubleNewlineIndex);
                    buffer = buffer.slice(doubleNewlineIndex + 2);

                    if (chunk.startsWith('data: ')) {
                        const dataStr = chunk.slice(6);
                        try {
                            const data = JSON.parse(dataStr);

                            if (data.type === 'info') {
                                appendTerminal(data.text, 'scan-info');
                            } else if (data.type === 'cmd') {
                                appendTerminal(data.text, 'scan-info');
                            } else {
                                appendTerminal(data.text);
                            }

                            if (data.text.includes('Scan complete')) {
                                resetUI();
                            }
                        } catch (err) {
                            console.error("Parse error chunk:", dataStr);
                        }
                    }
                }
            }

            resetUI();

        } catch (error) {
            appendTerminal(`Error initiating scan: ${error.message}`, 'error');
            resetUI();
        }
    });

    btnCancel.addEventListener('click', () => {
        if (eventSource) {
            eventSource.close();
        }
        appendTerminal('Scan cancelled by user.', 'error');
        resetUI();
        // Since we are reading stream locally via fetch, aborting isn't fully wired here, 
        // to properly abort in python backend we'd need another endpoint. 
        // For visual, this resets UI.
    });

    function resetUI() {
        btnScan.classList.remove('scanning');
        btnScan.disabled = false;
        btnCancel.style.display = 'none';
        appendTerminal('--- Scan workflow terminated ---', 'scan-info');
    }

    // Download functionality
    if (btnDownload) {
        btnDownload.addEventListener('click', () => {
            // Get text content without HTML tags
            let content = '';
            const lines = termOutput.querySelectorAll('.term-line');
            lines.forEach(line => {
                content += line.innerText + '\n';
            });

            if (!content.trim()) return;

            // Create blob and download link
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            a.download = `bugscanner-results-${timestamp}.txt`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
});
