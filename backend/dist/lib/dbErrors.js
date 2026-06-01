function rawTail(msg, max = 280) {
    const s = msg.trim();
    if (s.length <= max)
        return s;
    return `${s.slice(0, max)}…`;
}
/** Понятное описание ошибки СУБД для ответа API (рус.). */
export function explainDbRuntimeError(engine, error) {
    const msg = error instanceof Error ? error.message : String(error ?? 'unknown');
    const lower = msg.toLowerCase();
    // PostgreSQL (pg)
    const pgCode = error?.code;
    if (engine === 'postgres' && pgCode) {
        const map = {
            '23505': 'Такая запись уже есть: нарушено правило уникальности (дубликат ключа). Измените данные или удалите конфликтующую строку.',
            '23503': 'Нельзя сохранить: на эту строку ссылаются другие таблицы (внешний ключ). Сначала обновите или удалите связанные записи.',
            '23502': 'Не хватает обязательного поля (NOT NULL). Заполните все колонки без значения по умолчанию.',
            '23514': 'Значение не проходит проверку (CHECK). Посмотрите ограничения таблицы.',
            '42P01': 'Таблица или представление с таким именем не найдены. Проверьте название и схему.',
            '42703': 'В запросе указана колонка, которой нет в таблице.',
            '42601': 'Ошибка синтаксиса SQL. Проверьте запрос: скобки, запятые, кавычки.',
            '42P07': 'Объект с таким именем уже существует.',
            '53300': 'Слишком много подключений к серверу PostgreSQL — попробуйте позже или закройте лишние сессии.',
            '57014': 'Запрос отменён по таймауту или из‑за перегрузки.',
            '28P01': 'Неверный пароль или пользователь не может войти.',
            '3D000': 'Указанная база данных не существует.',
            '08006': 'Соединение с PostgreSQL разорвано. Проверьте, что сервер запущен и адрес верный.',
        };
        if (map[pgCode])
            return map[pgCode];
    }
    // MySQL / MariaDB (mysql2)
    const myNum = typeof error?.errno === 'number' ? error.errno : undefined;
    const myCode = error?.code;
    if (engine === 'mysql') {
        const byNum = {
            1045: 'Доступ запрещён: неверный логин или пароль, либо пользователю не разрешён вход с этого хоста.',
            1049: 'Базы с таким именем нет на сервере.',
            1062: 'Такая строка уже есть — дубликат по уникальному ключу.',
            1451: 'Нельзя удалить или обновить строку: на неё ссылаются другие таблицы.',
            1452: 'Нельзя добавить или изменить строку: связанная запись в другой таблице не найдена.',
            1146: 'Таблицы с таким именем нет.',
            1054: 'В запросе указано поле, которого нет в таблице.',
            1064: 'Синтаксическая ошибка в SQL.',
            1205: 'Превышено время ожидания блокировки — возможно, другая транзакция держит таблицу.',
            1213: 'Взаимная блокировка (deadlock). Повторите операцию.',
            2006: 'Соединение с MySQL разорвано.',
            2013: 'Потеряно соединение с сервером MySQL при выполнении запроса.',
        };
        if (myNum !== undefined && byNum[myNum])
            return byNum[myNum];
        if (myCode === 'ER_ACCESS_DENIED_ERROR')
            return byNum[1045];
        if (myCode === 'ER_NO_SUCH_TABLE')
            return byNum[1146];
        if (myCode === 'ER_DUP_ENTRY')
            return byNum[1062];
        if (lower.includes('access denied')) {
            return 'Доступ к MySQL запрещён: проверьте логин, пароль и что пользователю разрешён вход с вашего хоста.';
        }
    }
    // MongoDB
    if (engine === 'mongodb') {
        const mCode = error.code;
        const byMongo = {
            11000: 'Документ с таким уникальным ключом уже есть.',
            121: 'Документ не проходит проверку схемы валидации коллекции.',
            13: 'Недостаточно прав для этой операции в MongoDB.',
            18: 'Ошибка аутентификации к MongoDB — проверьте логин и пароль.',
        };
        if (mCode !== undefined && byMongo[mCode])
            return byMongo[mCode];
        if (lower.includes('authentication failed'))
            return byMongo[18];
        if (lower.includes('not authorized'))
            return byMongo[13];
        if (lower.includes('duplicate key'))
            return byMongo[11000];
        if (lower.includes('failed to connect') || lower.includes('mongonetworkerror')) {
            return 'Не удалось подключиться к MongoDB: сервер недоступен или неверный адрес/порт.';
        }
    }
    // Общие формулировки по тексту
    if (lower.includes('timeout') || lower.includes('timed out')) {
        return 'Истекло время ожидания ответа от базы. Попробуйте ещё раз или упростите запрос.';
    }
    if (lower.includes('econnrefused') || lower.includes('connection refused')) {
        return 'Сервер базы не принимает подключения — возможно, он выключен или порт указан неверно.';
    }
    if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
        return 'Не удалось найти сервер по указанному адресу (DNS или имя хоста).';
    }
    return `Не удалось выполнить операцию в базе: ${rawTail(msg)}`;
}
export function explainDbRuntimeErrorFromEngineLabel(engineLabel, error) {
    const e = engineLabel.toLowerCase();
    let kind = 'postgres';
    if (e.includes('mongo'))
        kind = 'mongodb';
    else if (e.includes('mysql') || e.includes('maria'))
        kind = 'mysql';
    return explainDbRuntimeError(kind, error);
}
