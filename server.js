const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./news.db');

// ========== ИНИЦИАЛИЗАЦИЯ БД ==========
db.serialize(() => {
    // Таблица новостей с полем created_at (дата добавления)
    db.run(`CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT,
        source TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ========== ФУНКЦИЯ УДАЛЕНИЯ СТАРЫХ НОВОСТЕЙ (старше 7 дней) ==========
function deleteOldNews() {
    db.run(`DELETE FROM news WHERE created_at < datetime('now', '-7 days')`, function(err) {
        if (err) {
            console.log('[ОЧИСТКА] Ошибка:', err.message);
        } else {
            console.log(`[ОЧИСТКА] Удалено ${this.changes} старых новостей (старше 7 дней)`);
        }
    });
}

// ========== РЕАЛЬНЫЕ НОВОСТИ ИЗ ОТКРЫТЫХ ИСТОЧНИКОВ (парсинг) ==========
async function fetchRealNews() {
    const sources = [
        { url: 'https://www.business-gazette.com/rss/all', type: 'xml', name: 'Бизнес Онлайн' },
        { url: 'https://realnoevremya.ru/rss', type: 'xml', name: 'Реальное время' },
        { url: 'https://tnv.ru/rss/news/', type: 'xml', name: 'ТНВ' }
    ];
    
    const parser = new xml2js.Parser({ explicitArray: false });
    let allNews = [];
    
    for (const src of sources) {
        try {
            const response = await axios.get(src.url, { timeout: 10000 });
            const result = await parser.parseStringPromise(response.data);
            let items = result?.rss?.channel?.item || [];
            
            if (items.length) {
                for (let item of items.slice(0, 3)) { // 3 новости с источника
                    const title = item.title || '';
                    if (!title) continue;
                    
                    let date = new Date(item.pubDate || Date.now());
                    let formattedDate = date.toLocaleDateString('ru-RU');
                    
                    let description = (item.description || item.summary || 'Подробнее на сайте').slice(0, 200);
                    
                    // Случайная картинка под тематику (реалистичные фото)
                    const images = [
                        'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600',
                        'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600',
                        'https://images.unsplash.com/photo-1558974449-5a556a8f9c3a?w=600',
                        'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=600',
                        'https://images.unsplash.com/photo-1564493774144-3e8ba9cf4b91?w=600',
                        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600'
                    ];
                    const randomImage = images[Math.floor(Math.random() * images.length)];
                    
                    allNews.push({
                        title: title,
                        date: formattedDate,
                        description: description,
                        image_url: randomImage,
                        source: src.name
                    });
                }
            }
        } catch(e) {
            console.log(`[ПАРСИНГ] Ошибка ${src.url}:`, e.message);
        }
    }
    
    return allNews;
}

// ========== РЕЗЕРВНЫЕ НОВОСТИ (если парсинг не дал результатов) ==========
function getFallbackNews() {
    const today = new Date().toLocaleDateString('ru-RU');
    return [
        { title: "В Муслюмово обсуждают строительство новой школы", date: today, desc: "Проект рассчитан на 600 мест, начало строительства — 2027 год.", image: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600", source: "Администрация" },
        { title: "Фермеры района готовятся к весеннему севу", date: today, desc: "Закуплено 200 тонн семян и удобрений.", image: "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600", source: "ТатАгро" },
        { title: "Концерт ко Дню Победы прошёл в ДК", date: today, desc: "Выступили местные коллективы и приглашённые артисты.", image: "https://images.unsplash.com/photo-1517454427005-3ad2b5b9b1b8?w=600", source: "Минкульт" }
    ];
}

// ========== ОСНОВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ НОВОСТЕЙ (раз в 24 часа) ==========
async function updateNews() {
    console.log('[ОБНОВЛЕНИЕ] Начинаю обновление новостей...', new Date().toISOString());
    
    // 1. Удаляем новости старше 7 дней
    deleteOldNews();
    
    // 2. Пытаемся получить реальные новости
    let freshNews = await fetchRealNews();
    
    // 3. Если реальных новостей нет — используем резервные
    if (freshNews.length === 0) {
        console.log('[ОБНОВЛЕНИЕ] Реальных новостей нет, использую резервные');
        freshNews = getFallbackNews();
    }
    
    // 4. Добавляем только уникальные новости (защита от дублей по заголовку за последние 24 часа)
    for (const news of freshNews) {
        const checkDuplicate = await new Promise((resolve) => {
            db.get(`SELECT id FROM news WHERE title = ? AND created_at > datetime('now', '-1 day')`, [news.title], (err, row) => {
                resolve(row);
            });
        });
        
        if (!checkDuplicate) {
            db.run(`INSERT INTO news (title, date, description, image_url, source) VALUES (?,?,?,?,?)`,
                [news.title, news.date, news.description, news.image_url, news.source],
                function(err) {
                    if (err) {
                        console.log('[ОБНОВЛЕНИЕ] Ошибка вставки:', err.message);
                    } else {
                        console.log(`[ОБНОВЛЕНИЕ] Добавлена новость: ${news.title.slice(0, 50)}...`);
                    }
                }
            );
        } else {
            console.log(`[ОБНОВЛЕНИЕ] Пропущен дубликат: ${news.title.slice(0, 40)}...`);
        }
    }
    
    console.log('[ОБНОВЛЕНИЕ] Цикл обновления завершён');
}

// ========== API: ПОЛУЧИТЬ ВСЕ НОВОСТИ (только свежие, не старше 7 дней) ==========
app.get('/api/news', (req, res) => {
    db.all(`SELECT * FROM news WHERE created_at > datetime('now', '-7 days') ORDER BY created_at DESC`, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// ========== API: ПОЛУЧИТЬ КОЛИЧЕСТВО НОВОСТЕЙ ==========
app.get('/api/news/count', (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM news WHERE created_at > datetime('now', '-7 days')`, (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ count: row.count });
    });
});

// ========== API: ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ (для тестов) ==========
app.post('/api/admin/force-update', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== 'SUPERSECRET2025') {
        return res.status(403).json({ error: 'Неверный ключ' });
    }
    updateNews().then(() => {
        res.json({ message: 'Принудительное обновление запущено' });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

// ========== ЗАПУСК ПЕРВИЧНОГО ОБНОВЛЕНИЯ И ТАЙМЕРА (каждые 24 часа) ==========
// При старте сервера
updateNews();

// Запускаем обновление каждые 24 часа (86400000 мс)
setInterval(updateNews, 24 * 60 * 60 * 1000);

// Также раз в час проверяем и удаляем старые новости (на всякий случай)
setInterval(deleteOldNews, 60 * 60 * 1000);

// ========== ЗАПУСК СЕРВЕРА ==========
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
    console.log(`📰 API новостей: http://localhost:${PORT}/api/news`);
    console.log(`🕐 Новости хранятся 7 дней, обновление каждые 24 часа`);
});