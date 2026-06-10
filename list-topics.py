import os, requests, json

token = os.environ.get('TELEGRAM_BOT_TOKEN')
chat_id = os.environ.get('TELEGRAM_CHAT_ID', '-1003524913240')

r = requests.post(f'https://api.telegram.org/bot{token}/getForumTopics', json={'chat_id': int(chat_id)})
d = r.json()
if d.get('ok') and d.get('result'):
    for t in d['result'].get('topics', []):
        print(f"{t['name']}: {t['message_thread_id']}")
else:
    print('Error:', d.get('description', ''))
