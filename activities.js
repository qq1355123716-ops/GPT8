const { randomUUID } = require('node:crypto');

function createActivities(db) {
  db.exec('CREATE TABLE IF NOT EXISTS activity_images (id TEXT PRIMARY KEY, activity_id INTEGER NOT NULL, position INTEGER NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL)');
  const describe = row => ({ ...row, images: db.prepare('SELECT id FROM activity_images WHERE activity_id = ? ORDER BY position').all(row.id).map(image => `/activity-images/${image.id}`) });
  return {
    validate(images = []) {
      if (!Array.isArray(images) || images.length > 6) throw new Error('最多添加 6 张图片。');
      return images.map(image => {
        const match = typeof image === 'string' && image.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片。');
        const data = Buffer.from(match[2], 'base64');
        if (data.length > 5 * 1024 * 1024) throw new Error('每张图片不能超过 5 MB。');
        if (data.toString('base64') !== match[2]) throw new Error('图片数据无效。');
        const mime = match[1];
        const valid = mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          : mime === 'image/jpeg' ? data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255
          : mime === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
          : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) throw new Error('图片格式与内容不符，请重新选择。');
        return { mime, data };
      });
    },
    list(before) {
      const rows = db.prepare('SELECT activities.id, content, created, COALESCE(profiles.display_name, users.username) AS username FROM activities JOIN users ON users.id = activities.user_id LEFT JOIN profiles ON profiles.user_id = users.id WHERE activities.id < ? ORDER BY activities.id DESC LIMIT 21').all(before);
      return { activities: rows.slice(0, 20).map(describe), next: rows.length > 20 ? rows[19].id : null };
    },
    save(userId, content, images, created) {
      db.exec('BEGIN');
      try {
        const result = db.prepare('INSERT INTO activities (user_id, content, created) VALUES (?, ?, ?)').run(userId, content, created);
        images.forEach((image, position) => db.prepare('INSERT INTO activity_images VALUES (?, ?, ?, ?, ?)').run(randomUUID(), result.lastInsertRowid, position, image.mime, image.data));
        const row = db.prepare('SELECT activities.id, content, created, COALESCE(profiles.display_name, users.username) AS username FROM activities JOIN users ON users.id = activities.user_id LEFT JOIN profiles ON profiles.user_id = users.id WHERE activities.id = ?').get(result.lastInsertRowid);
        const activity = describe(row);
        db.exec('COMMIT');
        return activity;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    image(id) { return db.prepare('SELECT mime, data FROM activity_images WHERE id = ?').get(id); }
  };
}
module.exports = { createActivities };
