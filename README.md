# Chia nhanh nhóm

Ứng dụng chia tiền nhóm chạy bằng Next.js, SQLite/libSQL và Netlify.

## Yêu cầu

- Node.js `>=22.13.0`

## Chạy local

```bash
npm install
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000). Khi không cấu hình biến môi trường, app tự tạo file SQLite `local.db` ở thư mục gốc.

## Kiểm tra production build

```bash
npm run build
npm start
```

## Database trên Netlify

Filesystem của Netlify Functions không phù hợp để lưu một file SQLite dùng chung. Bản production dùng Turso, một dịch vụ libSQL tương thích SQLite.

Thêm hai biến môi trường sau trong Netlify:

```text
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-token
```

Schema được tự khởi tạo khi API nhận request đầu tiên. Local và production dùng chung câu lệnh SQLite và cùng cấu trúc dữ liệu.
