const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./news.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT,
        source TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Добавляем демо-новости, если таблица пуста
    db.get("SELECT COUNT(*) as count FROM news", (err, row) => {
        if (row.count === 0) {
            const demoNews = [
                ['В Муслюмово завершили капремонт школы №2', '12.06.2025', 'Обновление спортивного зала, пищеблока и фасада. Созданы условия для углублённого изучения точных наук.', 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600', 'Муслюмовский район'],
                ['Аграрии района приступили к заготовке кормов', '10.06.2025', 'В 11 сельхозпредприятиях стартовала кампания по заготовке сенажа — запланировано 15 тыс. тонн.', 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600', 'ТатАгроНовости'],
                ['Праздник «Сабантуй-2025» пройдёт в Муслюмово 28 июня', '09.06.2025', 'Конная борьба, национальные игры, мастер-классы и концерт с участием звёзд татарской эстрады.', 'https://images.unsplash.com/photo-1558974449-5a556a8f9c3a?w=600', 'Минкульт РТ'],
                ['Новый ФАП открыт в деревне Ташлияр', '07.06.2025', 'Современное оборудование и комфортные условия приёма для 280 жителей.', 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=600', 'Минздрав РТ'],
                ['В районе стартовала догазификация', '05.06.2025', 'Ещё 6 населенных пунктов получат газ до октября 2025 года.', 'https://images.unsplash.com/photo-1564493774144-3e8ba9cf4b91?w=600', 'Татгазинвест']
            ];
            const stmt = db.prepare("INSERT INTO news (title, date, description, image_url, source) VALUES (?,?,?,?,?)");
            demoNews.forEach(n => stmt.run(n));
            stmt.finalize();
        }
    });
});

app.get('/api/news', (req, res) => {
    db.all("SELECT * FROM news ORDER BY date DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

async function parseAndSaveNews() {
    console.log('[ПАРСИНГ] Запуск...');
    const sources = [
        { url: 'https://www.business-gazeta.ru/rss/all', type: 'xml' }
    ];
    const parser = new xml2js.Parser({ explicitArray: false });
    
    for (const src of sources) {
        try {
            const response = await axios.get(src.url, { timeout: 10000 });
            const result = await parser.parseStringPromise(response.data);
            let items = result?.rss?.channel?.item || [];
            if (items.length) {
                for (let item of items.slice(0, 3)) {
                    const title = item.title || '';
                    const date = new Date(item.pubDate).toLocaleDateString('ru-RU');
                    const description = (item.description || '').slice(0, 200);
                    db.get("SELECT id FROM news WHERE title = ?", [title], (err, row) => {
                        if (!row && title) {
                            db.run(`INSERT INTO news (title, date, description, image_url, source) VALUES (?,?,?,?,?)`,
                                [title, date, description, 'https://images.unsplash.com/photo-1563897539633-3f6af64f0dc2?w=600', 'Бизнес Онлайн']);
                        }
                    });
                }
            }
        } catch(e) { console.log('Парсинг ошибка:', e.message); }
    }
}

parseAndSaveNews();
setInterval(parseAndSaveNews, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});