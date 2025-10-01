/**
 * @file Geminiチャットボットのフロントエンド用JavaScript
 * @description UI操作、API通信、状態管理など、すべてのフロントエンドロジックを管理します。
 * @version 4.1.0
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. UI要素の取得 ---
    const ui = {
        sidebar: document.getElementById('sidebar'),
        menuButton: document.getElementById('menu-button'),
        chatWindow: document.getElementById('chat-window'),
        chatForm: document.getElementById('chat-form'),
        messageInput: document.getElementById('message-input'),
        sendButton: document.getElementById('send-button'),
        sessionList: document.getElementById('session-list'),
        newChatButton: document.getElementById('new-chat-button'),
        toggleSettingsButton: document.getElementById('toggle-settings-button'),
        settingsPanel: document.getElementById('settings-panel'),
        personalityInput: document.getElementById('personality-input'),
        savePersonalityButton: document.getElementById('save-personality-button'),
        fileInput: document.getElementById('file-input'),
        filePreviewContainer: document.getElementById('file-preview-container'),
        fileNameSpan: document.getElementById('file-name'),
        removeFileButton: document.getElementById('remove-file-button'),
        chatTitle: document.getElementById('chat-title'),
    };

    // --- 2. 状態管理変数 ---
    let state = {
        currentSessionId: localStorage.getItem('active_chat_session_id') || null,
        attachedFile: null,
        isLoading: false,
    };

    // --- 3. API通信モジュール ---
    const api = {
        getSessions: () => fetch('/api/sessions').then(res => res.json()),
        getSession: (id) => fetch(`/api/session/${id}`).then(res => res.json()),
        deleteSession: (id) => fetch(`/api/session/${id}`, { method: 'DELETE' }),
        renameSession: (id, title) => fetch(`/api/session/${id}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }),
        pinSession: (id) => fetch(`/api/session/${id}/pin`, { method: 'POST' }),
        setPersonality: (personality) => fetch('/api/set_personality', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personality }) }),
        postChat: (formData) => fetch('/api/chat', { method: 'POST', body: formData }).then(res => res.json()),
    };

    // --- 4. UI描画モジュール ---
    const render = {
        sessions: (sessions) => {
            ui.sessionList.innerHTML = '';
            sessions.forEach(session => {
                const item = document.createElement('div');
                item.className = 'session-item';
                item.dataset.sessionId = session.id;
                item.innerHTML = `
                    <span class="session-title">${session.title}</span>
                    <div class="session-actions">
                        <button class="session-action-button pin-button ${session.pinned ? 'pinned' : ''}" title="ピン留め">📌</button>
                        <button class="session-action-button rename-button" title="名前を変更">✏️</button>
                        <button class="session-action-button delete-button" title="削除">🗑️</button>
                    </div>`;
                ui.sessionList.appendChild(item);
            });
            render.activeSessionHighlight();
        },
        chatHistory: (history) => {
            ui.chatWindow.innerHTML = '';
            history.forEach(msg => {
                const content = {
                    text: msg.parts.filter(p => !p.startsWith('/uploads/')).join(' '),
                    imageUrl: msg.parts.find(p => p.startsWith('/uploads/'))
                };
                render.message({ sender: msg.role === 'user' ? 'user' : 'bot', ...content });
            });
        },
        message: ({ sender, text, imageFile, imageUrl }) => {
            const el = document.createElement('div');
            el.className = `chat-message ${sender}-message`;
            const imageSrc = imageUrl || (imageFile ? URL.createObjectURL(imageFile) : null);
            if (imageSrc) {
                const img = document.createElement('img');
                img.src = imageSrc;
                img.className = 'message-image';
                el.prepend(img);
            }
            if (text) {
                const textEl = document.createElement('div');
                textEl.innerHTML = DOMPurify.sanitize(marked.parse(text));
                el.appendChild(textEl);
            }
            ui.chatWindow.appendChild(el);
            ui.chatWindow.scrollTop = ui.chatWindow.scrollHeight;
            return el;
        },
        activeSessionHighlight: () => {
            document.querySelectorAll('.session-item').forEach(item => {
                item.classList.toggle('active', item.dataset.sessionId === state.currentSessionId);
            });
        },
        filePreview: () => {
            if (state.attachedFile) {
                ui.fileNameSpan.textContent = state.attachedFile.name;
                ui.filePreviewContainer.classList.remove('hidden');
            } else {
                ui.filePreviewContainer.classList.add('hidden');
                ui.fileInput.value = '';
            }
        },
    };

    // --- 5. アプリケーションロジック ---
    const actions = {
        startNewChat: async () => {
            state.currentSessionId = `session-${Date.now()}`;
            localStorage.setItem('active_chat_session_id', state.currentSessionId);
            ui.chatWindow.innerHTML = '';
            ui.chatTitle.textContent = "新規チャット";
            render.message({ sender: 'bot', text: 'こんにちは！新しい会話を始めましょう。' });
            await actions.updateSessions();
        },
        loadSession: async (sessionId) => {
            if (!sessionId) return;
            ui.chatTitle.textContent = "読み込み中...";
            const data = await api.getSession(sessionId);
            if (data && data.history) {
                ui.chatTitle.textContent = data.title || "新規チャット";
                render.chatHistory(data.history);
            } else { await actions.startNewChat(); }
        },
        updateSessions: async () => render.sessions(await api.getSessions()),
        handleFile: (file) => {
            if (file && file.type.startsWith('image/')) {
                state.attachedFile = file;
                render.filePreview();
            } else { alert('画像ファイル（PNG, JPGなど）のみ添付できます。'); }
        },
        setFormEnabled: (enabled) => {
            state.isLoading = !enabled;
            ui.messageInput.disabled = !enabled;
            ui.sendButton.disabled = !enabled;
        }
    };

    // --- 6. イベントリスナー ---
    ui.menuButton.addEventListener('click', () => ui.sidebar.classList.toggle('visible'));
    ui.newChatButton.addEventListener('click', () => { actions.startNewChat(); ui.sidebar.classList.remove('visible'); });
    ui.toggleSettingsButton.addEventListener('click', () => ui.settingsPanel.classList.toggle('hidden'));
    ui.removeFileButton.addEventListener('click', () => { state.attachedFile = null; render.filePreview(); });
    ui.fileInput.addEventListener('change', () => ui.fileInput.files.length > 0 && actions.handleFile(ui.fileInput.files[0]));
    ui.savePersonalityButton.addEventListener('click', async () => {
        await api.setPersonality(ui.personalityInput.value);
        alert('人格を更新しました。');
        ui.settingsPanel.classList.add('hidden');
    });

    ui.sessionList.addEventListener('click', async (e) => {
        const item = e.target.closest('.session-item');
        if (!item) return;
        const sessionId = item.dataset.sessionId;
        const action = e.target.closest('.session-action-button');
        if (action) {
            e.stopPropagation();
            if (action.classList.contains('delete-button')) {
                if (confirm(`「${item.querySelector('.session-title').textContent}」を削除しますか？`)) {
                    await api.deleteSession(sessionId);
                    if (state.currentSessionId === sessionId) {
                        state.currentSessionId = null; localStorage.removeItem('active_chat_session_id');
                    }
                    await actions.updateSessions();
                    if (!state.currentSessionId) await actions.startNewChat();
                }
            } else if (action.classList.contains('rename-button')) {
                const newTitle = prompt("新しい名前:", item.querySelector('.session-title').textContent);
                if (newTitle && newTitle.trim()) await api.renameSession(sessionId, newTitle.trim());
                await actions.updateSessions();
            } else if (action.classList.contains('pin-button')) {
                await api.pinSession(sessionId); await actions.updateSessions();
            }
        } else {
            state.currentSessionId = sessionId; localStorage.setItem('active_chat_session_id', state.currentSessionId);
            await actions.loadSession(sessionId); render.activeSessionHighlight();
            ui.sidebar.classList.remove('visible');
        }
    });

    document.addEventListener('paste', e => {
        const file = Array.from(e.clipboardData.items).find(item => item.type.startsWith('image/'))?.getAsFile();
        if (file) { actions.handleFile(file); e.preventDefault(); }
    });

    ui.chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userMessage = ui.messageInput.value.trim();
        if ((!userMessage && !state.attachedFile) || !state.currentSessionId || state.isLoading) return;
        actions.setFormEnabled(false);
        render.message({ sender: 'user', text: userMessage, imageFile: state.attachedFile });
        const formData = new FormData();
        formData.append('session_id', state.currentSessionId);
        formData.append('message', userMessage);
        if (state.attachedFile) formData.append('file', state.attachedFile);
        state.attachedFile = null; render.filePreview(); ui.messageInput.value = '';
        const loadingMessage = render.message({ sender: 'bot', text: '考え中...' });
        try {
            const data = await api.postChat(formData);
            ui.chatWindow.removeChild(loadingMessage);
            render.message({ sender: 'bot', text: data.reply || data.error });
            if (data.title) ui.chatTitle.textContent = data.title;
            await actions.updateSessions();
        } catch (error) {
            loadingMessage.textContent = "エラー: メッセージの送信に失敗しました。";
        } finally {
            actions.setFormEnabled(true);
        }
    });

    // --- 7. 初期化 ---
    const initialize = async () => {
        await actions.updateSessions();
        const firstSession = ui.sessionList.querySelector('.session-item');
        let sessionToLoad = state.currentSessionId;

        if (sessionToLoad && !document.querySelector(`.session-item[data-session-id="${sessionToLoad}"]`)) {
            sessionToLoad = null; 
        }
        
        if (!sessionToLoad && firstSession) {
            sessionToLoad = firstSession.dataset.sessionId;
        }

        if (sessionToLoad) {
            state.currentSessionId = sessionToLoad;
            localStorage.setItem('active_chat_session_id', state.currentSessionId);
            await actions.loadSession(state.currentSessionId);
        } else {
            await actions.startNewChat();
        }
        ui.sidebar.classList.remove('visible');
    };

    initialize();
});