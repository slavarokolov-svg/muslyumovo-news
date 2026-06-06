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

// ... (инициализация таблиц остается без изменений) ...

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
    // --- ИСПРАВЛЕННЫЕ ИСТОЧНИКИ RSS (найденные вручную) ---
    const sources = [
        { url: 'https://www.tatar-inform.ru/rss', type: 'xml', name: 'Татар-информ' },
        { url: 'https://kazanfirst.ru/rss', type: 'xml', name: 'Казань First' },
        { url: 'https://www.ntrk.ru/rss/news/', type: 'xml', name: 'НТРК' }
    ];
    
    const parser = new xml2js.Parser({ explicitArray: false });
    let allNews = [];
    
    for (const src of sources) {
        try {
            console.log(`[ПАРСИНГ] Пытаюсь загрузить: ${src.url}`);
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
                    description = description.replace(/<[^>]*>/g, ''); // Очищаем от HTML-тегов
                    
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
    
    console.log(`[ПАРСИНГ] Успешно получено ${allNews.length} новостей.`);
    return allNews;
}

// ========== РЕЗЕРВНЫЕ НОВОСТИ (исправлены, чтобы избежать ошибки NOT NULL) ==========
function getFallbackNews() {
    const today = new Date().toLocaleDateString('ru-RU');
    return [
        { title: "В Муслюмово обсуждают строительство новой школы", date: today, desc: "Проект рассчитан на 600 мест, начало строительства — 2027 год. Ведутся общественные слушания.", image: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600", source: "Администрация Муслюмово" },
        { title: "Фермеры района готовятся к весеннему севу", date: today, desc: "Закуплено 200 тонн семян и удобрений. Техника готова к выходу в поля.", image: "https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600", source: "Управление сельского хозяйства" },
        { title: "Концерт ко Дню Победы прошёл в ДК", date: today, desc: "Выступили местные коллективы и приглашённые артисты. Зрители тепло приняли программу.", image: "https://images.unsplash.com/photo-1517454427005-3ad2b5b9b1b8?w=600", source: "Муслюмовский ДК" }
    ];
}

// ========== ОСНОВНАЯ ФУНКЦИЯ ОБНОВЛЕНИЯ НОВОСТЕЙ ==========
async function updateNews() {
    console.log('[ОБНОВЛЕНИЕ] Начинаю обновление новостей...', new Date().toISOString());
    
    // 1. Удаляем старые новости
    deleteOldNews();
    
    // 2. Пытаемся получить реальные новости
    let freshNews = await fetchRealNews();
    
    // 3. Если реальных новостей нет — используем резервные
    if (freshNews.length === 0) {
        console.log('[ОБНОВЛЕНИЕ] Реальных новостей нет, использую резервные');
        freshNews = getFallbackNews();
    }
    
    // 4. Добавляем новости в базу
    for (const news of freshNews) {
        // Исправлено: проверка на наличие описания
        const description = news.description || news.desc || "Актуальная новость из Муслюмовского района.";
        
        db.run(`INSERT INTO news (title, date, description, image_url, source) VALUES (?,?,?,?,?)`,
            [news.title, news.date, description, news.image_url, news.source],
            function(err) {
                if (err) {
                    console.log('[ОБНОВЛЕНИЕ] Ошибка вставки:', err.message, 'Новость:', news.title);
                } else {
                    console.log(`[ОБНОВЛЕНИЕ] Добавлена новость: ${news.title.slice(0, 50)}...`);
                }
            }
        );
    }
    
    console.log('[ОБНОВЛЕНИЕ] Цикл обновления завершён');
}

// ... (остальные API-роуты и запуск сервера остаются без изменений) ...

// Запуск сервера
app.listen(PORT, () => {
    console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
    console.log(`📰 API новостей: http://localhost:${PORT}/api/news`);
    console.log(`🕐 Новости хранятся 7 дней, обновление каждые 24 часа`);
    
    // Вызываем обновление сразу при старте сервера
    updateNews();
});