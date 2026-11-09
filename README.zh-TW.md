# 台灣天眼 · Taiwan God's Eye View

這是 [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) 的台灣版分支（`taiwan` 分支）。原專案以 MIT 授權釋出，本分支沿用相同授權。

在瀏覽器裡的寫實 3D 地球上，即時呈現航空器、船舶、衛星、地震、天氣與公開攝影機，並可用語音操作。台灣版在上游功能之外加入：

## 台灣版新增內容

| 項目         | 內容                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 繁體中文介面 | 新增 `zh-TW` 語系，翻譯全部約 2,700 條介面字串。瀏覽器語言是任何中文（zh、zh-TW、zh-Hant、zh-HK…）時自動套用；也可用右下角地球按鈕切換，或在網址加 `?lang=zh-TW`。 |
| 開場聚焦台灣 | 開啟時先俯瞰台灣全島，再飛進台北 101。                                                                                                                             |
| 台灣城市預設 | 台北、台中、高雄、台南、新竹、花蓮，各 5 個地標（地標名稱在中文介面顯示中文）。原本的國外城市仍保留在後面。                                                        |
| 台灣 CCTV    | 交通部公路局（省道、快速公路）與高速公路局（國道）的公開即時影像，免金鑰。                                                                                         |
| YouBike      | 台北市 YouBike 2.0 即時站點與車輛數，接入公共自行車圖層，免金鑰。                                                                                                  |
| 品牌         | 標題、載入畫面與 PWA 名稱改為「台灣天眼」。                                                                                                                        |
| 台灣 3D 建物 | 國土測繪中心 3D Tiles（台北用分棟版），疊在衛星影像上，只載入畫面附近的縣市；「地圖來源」面板可開關。                                                              |
| 台灣水情     | 「事件」圖層組的「台灣水情」：河川水位（依警戒值上色）、淹水感測器、主要水庫水位與有效蓄水量，每 10 分鐘更新。                                                     |

航班（ADS-B）、船舶（AIS）、衛星、USGS 地震、GFS/ECMWF 天氣、颱風路徑等全球圖層原本就涵蓋台灣，不需額外設定。

## 線上展示

**https://onework-io.github.io/taiwan-eye/**（GitHub Pages 靜態展示版，`main` 每次更新會自動重新發布）

GitHub Pages 只能放靜態檔案，所以需要伺服器轉接的圖層（台灣水情、CCTV、YouBike、行動基地台、航班、船舶等）在線上版不會動；地球、衛星影像、台灣 3D 建物、城市地標與視覺風格都可以用。完整功能請在本機執行（見下方）。

## 快速開始

需要 **Node.js 24.x（24.14.0 以上）或 26.x**。

```bash
cd gods-eye-view
git checkout taiwan
npm ci
npm run doctor
npm run dev
```

打開 **http://localhost:4173**。

要看寫實 3D 建築，請在 app 裡的 **POWER UP** 面板加入 Cesium ion token 或 Google Maps 金鑰（見上游 README 的「API Keys」）。

## 台灣資料來源

| 圖層             | 來源                                                                                                                                                  | 授權                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 公路局 CCTV      | `https://cctv-maintain.thb.gov.tw/opendataCCTVs.xml`（備援 `thbapp.thb.gov.tw/opendata/cctv/info/cctvs.xml`），MOTC v2.0 XML，取 `/snapshot` 靜態影像 | 政府資料開放授權條款 第1版 |
| 國道 CCTV        | `https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml`（備援 `thbapp.thb.gov.tw/services/cctv/freeway`），影像為 MJPEG，伺服器擷取第一張 JPEG     | 政府資料開放授權條款 第1版 |
| YouBike 2.0 台北 | `https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json`，由 `server/providers/youbike.js` 轉成 GBFS                         | 政府資料開放授權條款 第1版 |
| 3D 建物          | `https://3dtiles.nlsc.gov.tw/building/tiles3d/<縣市代碼>/tileset.json`（國土測繪中心，免申請）                                                        | 國土測繪中心介接規範       |
| 河川水位、水庫   | 水利署水利資料開放平台 `https://opendata.wra.gov.tw/api/v2/…`（站況、即時水位、水庫水情、水庫每日營運），由 `server/providers/taiwanWater.js` 整合    | 政府資料開放授權條款 第1版 |
| 淹水感測器       | 民生公共物聯網 SensorThings `https://sta.colife.org.tw/STA_WaterResource_v2/v1.0/Datastreams`（水利署淹水深度）                                       | 政府資料開放授權條款 第1版 |

各來源可用環境變數關閉或調整數量：

```bash
CCTV_TAIWAN_THB_ENABLED=0          # 關閉公路局 CCTV
CCTV_TAIWAN_NFB_ENABLED=0          # 關閉國道 CCTV
CCTV_TAIWAN_THB_MAX_SOURCES=800    # 公路局攝影機上限（預設 800）
CCTV_TAIWAN_NFB_MAX_SOURCES=800    # 國道攝影機上限（預設 800）
```

## 尚未接上（需要 TDX 金鑰或申請）

- **縣市 CCTV、公車、捷運、台鐵即時資料**：多數只在 [TDX 運輸資料流通服務](https://tdx.transportdata.tw/) 提供，需要 Client ID / Secret。
- **臺北市交控 CCTV 影像**：需向臺北市交通管制工程處申請並簽約。
- **中央氣象署地震、雷達**：需要氣象署開放資料授權碼；目前地震使用 USGS 全球資料（已含台灣）。

## 檔案位置

- 台灣 CCTV：`server/providers/cctv/taiwan.js`
- YouBike 轉 GBFS：`server/providers/youbike.js`
- 城市與地標：`src/cityPois.js`
- 開場鏡頭：`src/camera.js`（`flyToTaiwan`）
- 中文翻譯：`src/i18n/locales/zh-TW.json`，用語表：`docs/translations/zh-TW.md`

## 跟上游同步

```bash
git fetch upstream
git merge upstream/main     # 在 taiwan 分支上
npm run i18n                # 列出上游新增、尚未翻譯的字串
```

## 注意

- 水庫資料本身沒有座標，位置取自 `src/layers/taiwanWater/records.js` 裡主要水庫的約略座標；表裡沒有的水庫（多為攔河堰）不顯示。
- 「台灣水情」的分享連結代碼用 `zz`，刻意避開上游未來會用的代碼，所以 `npm run layer-token:check` 會提示它不是「下一個代碼」，這是預期中的。
