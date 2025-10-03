# app.py (日本語化・最終改善版)

import os
import json
import uuid
from PIL import Image
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import google.generativeai as genai

# --- 1. 初期設定 ---
load_dotenv()

# 定数とフォルダ設定
PERSONALITY_FILE = "personality.json"
SESSIONS_FILE = "chat_sessions.json"
UPLOADS_FOLDER = "uploads" # 画像を保存するフォルダ
DEFAULT_PERSONALITY = """
あなたはZONEWATCHのAIです。グラフやデータの説明が得意で、必ずChain-of-Thought（思考の連鎖）を使って、段階的に推論・説明を行います。
【制約条件】
- 必ず「ステップバイステップ」で考え、推論の過程を明示してください。
- 問題を分解し、各ステップで何を考えているかを説明してください。
- 計算や根拠がある場合は必ず示してください。
- 最終的な答えの前に、思考の流れを箇条書きや文章で整理してください。
- 途中で分からないことがあれば、仮定や追加情報を述べてください。
- 回答例：
    1. まず○○について考えます。
    2. 次に△△を確認します。
    3. 以上より、□□と判断できます。
- 必ず「Chain-of-Thought（思考の連鎖）」を意識して、推論の過程を丁寧に説明してください。
"""

# uploadsフォルダが存在しない場合は作成
if not os.path.exists(UPLOADS_FOLDER):
    os.makedirs(UPLOADS_FOLDER)

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# --- 2. Google Gemini APIの設定 ---
try:
    api_key = "AIzaSyA0IZW7yEAdZ20eJ5urvVxHYGotzl1qO5c"
    if not api_key: raise ValueError("環境変数 'GEMINI_API_KEY' が設定されていません。")
    genai.configure(api_key=api_key)
    print("✅ Gemini APIの設定が完了しました。")
except Exception as e:
    print(f"❌ Gemini APIの初期化に失敗: {e}")

# --- 3. データ永続化ヘルパー関数 ---
def load_data(filepath, default_data):
    if not os.path.exists(filepath): return default_data
    try:
        with open(filepath, 'r', encoding='utf-8') as f: return json.load(f)
    except (IOError, json.JSONDecodeError): return default_data

def save_data(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, indent=2)

# --- 4. グローバル変数の読み込み ---
# 人格設定は常に DEFAULT_PERSONALITY をベースにし、ユーザーが設定した追加の指示（override）を結合する設計にする。
# ファイルには "override" 部分のみを保存し、実際にモデルに渡す system_instruction は常に
# DEFAULT_PERSONALITY + "\n" + user_personality となる。
personality_data = load_data(PERSONALITY_FILE, {"personality": ""})
user_personality = personality_data.get("personality", "") or ""
system_instruction = DEFAULT_PERSONALITY + ("\n" + user_personality if user_personality else "")
chat_sessions_data = load_data(SESSIONS_FILE, {})

# =================================
#  APIエンドポイント
# =================================

# --- 4.1. アップロードされたファイルを提供するエンドポイント ---
@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    """uploadsフォルダから画像ファイルを配信する"""
    return send_from_directory(UPLOADS_FOLDER, filename)

# --- 4.2. 会話セッション管理API ---
@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    session_list = [{"id": session_id, **data} for session_id, data in chat_sessions_data.items()]
    session_list.sort(key=lambda x: (x.get('pinned', False), x.get('id', '')), reverse=True)
    return jsonify(session_list)

@app.route('/api/session/<session_id>', methods=['GET'])
def get_session_history(session_id): return jsonify(chat_sessions_data.get(session_id, {}))

@app.route('/api/session/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    if session_id in chat_sessions_data:
        del chat_sessions_data[session_id]; save_data(SESSIONS_FILE, chat_sessions_data)
        return jsonify({"status": "success"})
    return jsonify({"error": "セッションが見つかりません。"}), 404

@app.route('/api/session/<session_id>/rename', methods=['POST'])
def rename_session(session_id):
    if session_id in chat_sessions_data:
        new_title = request.get_json().get('title', '').strip()
        if new_title:
            chat_sessions_data[session_id]['title'] = new_title; save_data(SESSIONS_FILE, chat_sessions_data)
            return jsonify({"status": "success"})
        return jsonify({"error": "タイトルが空です。"}), 400
    return jsonify({"error": "セッションが見つかりません。"}), 404

@app.route('/api/session/<session_id>/pin', methods=['POST'])
def pin_session(session_id):
    if session_id in chat_sessions_data:
        is_pinned = chat_sessions_data[session_id].get('pinned', False)
        chat_sessions_data[session_id]['pinned'] = not is_pinned; save_data(SESSIONS_FILE, chat_sessions_data)
        return jsonify({"status": "success", "pinned": not is_pinned})
    return jsonify({"error": "セッションが見つかりません。"}), 404

# --- 4.3. チャットと設定のAPI ---
@app.route('/api/set_personality', methods=['POST'])
def set_personality():
    """ユーザーが入力した人格（オーバーライド部分）を保存し、
    実際にモデルに渡す system_instruction は常に DEFAULT_PERSONALITY を先頭に付与する。
    """
    global system_instruction, user_personality
    override = request.get_json().get('personality', '').strip() or ""
    # ファイルにはオーバーライド部分のみを保存する
    save_data(PERSONALITY_FILE, {"personality": override})
    user_personality = override
    system_instruction = DEFAULT_PERSONALITY + ("\n" + user_personality if user_personality else "")
    return jsonify({"status": "success", "message": "人格（オーバーライド）を保存しました。"})

@app.route('/api/chat', methods=['POST'])
def handle_chat():
    session_id = request.form.get('session_id')
    user_input = request.form.get('message', '').strip()
    file = request.files.get('file')

    if not session_id or (not user_input and not file): return jsonify({"error": "必須情報が不足しています。"}), 400

    try:
        model = genai.GenerativeModel(model_name="gemini-2.5-pro", system_instruction=system_instruction)
        
        session_data = chat_sessions_data.get(session_id, {"title": "", "history": [], "pinned": False})
        past_history = session_data.get("history", [])
        
        user_parts_for_api = [part for part in ([user_input] if user_input else []) + ([Image.open(file.stream)] if file else [])]
        
        response = model.generate_content(past_history + [{'role': 'user', 'parts': user_parts_for_api}])
        
        user_parts_for_history = [user_input] if user_input else []
        if file:
            ext = os.path.splitext(file.filename)[1]
            unique_filename = f"{uuid.uuid4()}{ext}"
            filepath = os.path.join(UPLOADS_FOLDER, unique_filename)
            file.seek(0)
            file.save(filepath)
            user_parts_for_history.append(f"/uploads/{unique_filename}")

        new_history = past_history + [
            {'role': 'user', 'parts': user_parts_for_history},
            {'role': 'model', 'parts': [response.text]}
        ]
        
        session_data["history"] = new_history
        if not session_data.get("title"):
             session_data["title"] = user_input[:40] or (file.filename if file else "新しいチャット")
        
        chat_sessions_data[session_id] = session_data
        save_data(SESSIONS_FILE, chat_sessions_data)

        return jsonify({"reply": response.text, "title": session_data["title"]})

    except Exception as e:
        print(f"❌ APIエラー: {e}")
        return jsonify({"error": "APIとの通信中、またはファイル処理中にエラーが発生しました。"}), 500

@app.route('/')
def serve_index(): return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__': app.run(host='0.0.0.0', port=5000, debug=True)
