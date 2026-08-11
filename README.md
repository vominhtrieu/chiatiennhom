# Chia nhanh nhóm

Ứng dụng chia tiền nhóm chạy local bằng Next.js và SQLite.

## Yêu cầu

- Node.js `>=22.13.0`

## Chạy local

```bash
npm install
npm run dev
```

Mở [http://localhost:9999](http://localhost:9999). App tự tạo file SQLite `local.db` ở thư mục gốc, không cần cài hoặc cấu hình database riêng.

Muốn lưu database ở vị trí khác, tạo `.env.local`:

```text
SQLITE_DATABASE_PATH=/duong/dan/toi/chia-tien.db
```

## Chạy production trên máy local

```bash
npm run build
npm start
```

Cả development server và production server đều chạy ở port `9999`.

## Lưu ý

File SQLite là dữ liệu local trên một máy và không phù hợp với môi trường serverless.
