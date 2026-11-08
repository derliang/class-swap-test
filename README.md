# class-swap-test｜調課小幫手網頁版技術驗證

**僅合成資料的技術驗證頁，不含真實課表、不含教師姓名。** 這裡只放建置後的靜態檔，不是正式工具，測試結束後會封存。

- 網址：https://derliang.github.io/class-swap-test/
- `index.html`：在瀏覽器背景執行緒（Web Worker）載入調課引擎與 HiGHS 求解器，跑合成學校的情境，比對 Node 版結果。
- `smoke/`：資料夾存取與寫入原子性的煙霧測試頁（File System Access API）。

© 2026 derliang. All rights reserved.
