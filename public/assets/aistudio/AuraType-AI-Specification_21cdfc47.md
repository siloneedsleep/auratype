Tài liệu triển khai AuraType AI dành cho AI Coding Agent. Phần 6–16 bổ sung logic chi tiết và có quyền ưu tiên khi có mâu thuẫn với mô tả ý tưởng ở phần 1–5. Các giá trị mặc định dưới đây là quyết định sản phẩm cho phiên bản đầu, có thể điều chỉnh sau khi thử nghiệm.

---

# Project Specification: AuraType AI – Cinematic & Dynamic Typing Studio

## 1. Tổng quan dự án

Xây dựng một web-app luyện gõ phím siêu mượt (60-120 FPS), kết hợp **LLM-generated text** độc nhất cho mỗi lần luyện, **Cơ chế Cooldown 30s chống spam**, **History Vault với Ghost Caret (đua với kỷ lục cũ)** và **Hệ thống Full Animation đỉnh cao (Ultra Juice Mode)** lấy cảm hứng từ các giao diện Cinematic/Game UI.

---

## 2. Tech Stack bắt buộc

* **Framework:** Next.js (App Router, TypeScript)
* **Styling:** Tailwind CSS + CSS Variables cho theme
* **Animation & Motion:** Framer Motion (spring physics, layoutId, layout animations)
* **Graphics & Particles:** HTML5 Canvas (cho hiệu ứng hạt khi gõ sai, shockwave)
* **Audio:** Web Audio API (tạo âm thanh cơ học switch bàn phím không độ trễ)
* **State Management:** Zustand (quản lý trạng thái gõ thời gian thực)
* **Local Database:** Dexie.js (IndexedDB wrapper lưu trữ History & Ghost Replay)

---

## 3. Cấu trúc Thư mục (Directory Structure)

```text
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── modals/
│   │   ├── PerformanceGate.tsx    # Popup chọn Ultra Juice vs Zen Mode
│   │   ├── SettingsModal.tsx      # Bảng cấu hình toàn năng
│   │   └── ResultModal.tsx        # Màn hình kết thúc (Odometer, Rank Stamp)
│   ├── typing/
│   │   ├── TypingCanvas.tsx       # Canvas cho hiệu ứng hạt & shockwave
│   │   ├── Caret.tsx              # Comet Caret với spring physics & motion trail
│   │   ├── VirtualKeyboard.tsx    # Bàn phím ảo 2.5D phản hồi xúc giác
│   │   └── HeaderBar.tsx          # Nút Generate AI, Cooldown timer, Settings icon
│   └── history/
│       └── HistoryDrawer.tsx      # Ngăn kéo lịch sử & danh sách bài cũ
├── store/
│   ├── useTypingStore.ts          # State máy gõ, WPM, Accuracy, Combo
│   └── useSettingsStore.ts        # Cấu hình âm thanh, animation, cooldown
├── services/
│   ├── llmService.ts              # Gọi API sinh text (Streaming / JSON)
│   └── dbService.ts               # Dexie.js IndexedDB quản lý History & PB
└── utils/
    ├── soundFX.ts                 # Web Audio API sound generator
    └── calculations.ts            # Tính WPM, Accuracy, Ghost Replay diff

```

---

## 4. Chi tiết các Module & Yêu cầu Kỹ thuật

### Module 1: Performance Gate Modal (Khởi động)

* Khi truy cập lần đầu, hiện modal phủ mờ (`backdrop-blur-xl`).
* **2 lựa chọn:**
1. **⚡ Ultra Juice Mode:** Bật toàn bộ hạt, vật lý lò xo, shockwave, kính mờ.
2. **🍃 Zen / Lite Mode:** Tắt toàn bộ hiệu ứng nặng, tối ưu cho máy yếu.


* Sau khi chọn, modal thu nhỏ và bay về góc màn hình (`layoutId`) làm nút bật/tắt FX nhanh. Lưu lựa chọn vào `localStorage`.

### Module 2: LLM Generation & Cooldown 30s System

* **Nút "Generate AI Text":**
* Khi bấm, gọi API sinh đoạn văn bản ngẫu nhiên theo chủ đề (Code, Triết học, Sci-fi) và độ dài đã chọn trong Settings.
* Hiệu ứng chữ xuất hiện dạng **Scramble / Matrix Text Reveal**.


* **Cooldown 30s & Overheat Mechanic:**
* Sau khi bấm, nút chuyển sang trạng thái nạp năng lượng với hiệu ứng **Liquid Wave SVG** dâng từ đáy lên trong 30s.
* *Chống F5:* Lưu `lastGeneratedAt` timestamp vào `localStorage` để tính tiếp thời gian hồi chiêu nếu reload trang.
* Cố tình bấm khi đang cooldown: Nút giật ngang (shake), viền chớp đỏ, báo lỗi *"AI Core Overheated"*.
* Các nút *Retry (Gõ lại bài hiện tại)* và *History* có **0s cooldown**.



### Module 3: Typing Engine & Full Animation ("The Juice")

* **Ký tự & Từ:**
* Chữ chờ gõ mờ (`opacity: 0.4`).
* Gõ đúng: Chữ nảy nhẹ (`scale` + lò xo) và sáng rực.
* Gõ sai: Chữ đổi màu đỏ, **rung giật ngang dữ dội**, bắn ra 3-5 hạt bụi (Canvas debris) rơi xuống theo trọng lực.
* Combo: Chuỗi gõ đúng tăng điểm combo. Gõ sai làm vỡ vụn số combo và gây micro screen-shake.


* **Comet Caret:**
* Con trỏ di chuyển bằng spring physics mượt mà, kéo theo vệt sáng (motion trail) đổi màu theo tốc độ WPM (Xanh -> Tím -> Vàng Neon).


* **Grand Finale (Hoàn thành bài):**
* Gõ ký tự cuối -> Kích hoạt **Shockwave ring** lan tỏa từ tâm, biến chữ thành hạt sáng.
* Hiện Result Modal: Số WPM chạy hiệu ứng số nhảy (Odometer), biểu đồ tốc độ vẽ theo thời gian thực, và đóng con dấu Rank (`S+`, `S`, `A`) kèm pháo giấy (Confetti).



### Module 4: History Vault & Ghost Caret

* Lưu mỗi bài được tạo vào `IndexedDB` qua Dexie.js (gồm ID, nội dung, timestamp, danh sách attempts).
* **Ghost Replay:** Khi chọn lại một bài cũ từ History để luyện:
* Hiển thị **2 con trỏ**: Con trỏ hiện tại của user và **Ghost Caret** (bóng mờ chạy theo đúng nhịp độ của kỷ lục cá nhân - PB trước đó).



### Module 5: Settings Center Modal

* Truy cập qua phím `Esc` hoặc icon bánh răng.
* **Tabs cấu hình:**
* *Visuals:* Bật/tắt Ultra Juice, tùy chỉnh Comet Caret.
* *Acoustic:* Bật/tắt âm thanh gõ, chọn Sound Profile (Creamy, Thock, Typewriter), chỉnh Volume.
* *AI & Rules:* Chỉnh thời gian Cooldown (15s - 60s), độ dài bài (Short, Medium, Long), nhập Custom API Key.
* *Data:* Xóa lịch sử, Export/Import dữ liệu JSON.



---

## 5. Hướng dẫn cho Agent khi triển khai

1. Khởi tạo cấu trúc thư mục và cài đặt các package cần thiết (`framer-motion`, `canvas-confetti`, `dexie`, `lucide-react`, `zustand`).
2. Xây dựng tầng `store` trước để quản lý trạng thái gõ và cài đặt.
3. Tạo các component UI tĩnh và modal trước, sau đó tích hợp Framer Motion cho các hiệu ứng chuyển động.
4. Viết logic xử lý Web Audio API và HTML5 Canvas riêng biệt để tối ưu hiệu suất 60 FPS.
5. Kiểm tra kỹ cơ chế Cooldown lưu vào `localStorage` để không bị mất trạng thái khi F5 trang.

---

## 6. Quyết định sản phẩm và phạm vi phiên bản đầu

* Chế độ chính: hoàn thành một đoạn văn, không giới hạn thời gian, cho phép gõ sai rồi sửa hoặc tiếp tục.
* Mở app là có bài mẫu để gõ ngay. Performance Gate không chặn lần sử dụng đầu; thay bằng lựa chọn FX nhỏ trên giao diện và lưu lựa chọn.
* Mặc định FX nhẹ, âm thanh tắt. Ultra Juice là tùy chọn. Tôn trọng `prefers-reduced-motion` và luôn cho phép tắt rung màn hình riêng.
* Ngôn ngữ ban đầu: tiếng Anh và tiếng Việt có dấu. Chủ đề Code chỉ là nội dung luyện gõ, tuyệt đối không thực thi mã sinh ra.
* Short: 150–300 ký tự; Medium: 400–700; Long: 900–1.400. Đếm theo grapheme (ký tự hiển thị), gồm khoảng trắng.
* Bản đầu không cần tài khoản, bảng xếp hạng công khai hay đồng bộ đa thiết bị. Dữ liệu luyện tập nằm trên trình duyệt hiện tại.
* Ưu tiên độ chính xác và độ phản hồi khi gõ. Không cam kết 120 FPS trên mọi thiết bị; 120 FPS chỉ là mục tiêu trên màn hình và phần cứng phù hợp.

## 7. Typing Engine: trạng thái và luật nhập liệu

### 7.1. State machine

```text
loading -> ready -> running -> completed
loading -> error -> loading / ready (bài mẫu)
running -> interrupted -> ready (lượt mới)
ready / running / completed -> ready (retry hoặc chọn bài khác)
```

* `loading`: đang nạp bài ban đầu. Tạo bài AI từ header có trạng thái request riêng, không xóa bài hiện tại khi request chưa thành công.
* `ready`: có nội dung hợp lệ, chưa bắt đầu tính giờ.
* `running`: bắt đầu từ lần nhập văn bản hợp lệ đầu tiên. Modifier, phím mũi tên, click và focus không bắt đầu đồng hồ. Lần gõ sai đầu tiên vẫn bắt đầu đồng hồ.
* `completed`: ký tự cuối đã được nhập đúng và số ký tự đã nhập bằng độ dài bài. Khóa dữ liệu kết quả ngay tại thời điểm này.
* `interrupted`: mất focus trong lúc chạy, đổi tab, mở Settings/History hoặc cửa sổ bị ẩn. Lượt này kết thúc dạng bỏ dở, không có điểm hay PB. Hiện nút bắt đầu lại; không tự khởi động lượt mới khi người dùng quay lại.
* Không có pause/resume ở bản đầu để tránh kết quả bị ảnh hưởng bởi việc nghỉ giữa bài.
* Retry tạo `attemptId` mới, xóa tiến độ và timer, giữ nguyên nội dung. Bài mới hoặc History khi đang chạy phải có hộp xác nhận bỏ lượt hiện tại.
* Reload giữa bài không phục hồi lượt đang gõ. Giữ bài hiện tại nếu đã lưu thành công, quay về `ready`.

### 7.2. Mô hình nhập liệu

* Dùng một textarea thật để nhận input và composition; lớp chữ và caret chỉ phản chiếu trạng thái. Không dùng global `keydown` làm nguồn văn bản duy nhất.
* Chuẩn hóa nội dung sang Unicode NFC; tách bằng `Intl.Segmenter` với `granularity: 'grapheme'`. Có thư viện fallback nếu trình duyệt thiếu API này.
* Mỗi grapheme được chốt vào input chiếm một vị trí, đúng hoặc sai so với grapheme đích ở cùng vị trí. Không phân tách từ để tính tiến độ.
* So sánh phân biệt hoa/thường và dấu. Khoảng trắng là ký tự phải gõ. Nội dung bài dùng dấu cách thường U+0020, không chứa tab hoặc xuống dòng ở bản đầu, kể cả chủ đề Code.
* Chỉ cho nhập và xóa ở cuối chuỗi. Click vào chữ không di chuyển vị trí nhập; không hỗ trợ sửa giữa bài hoặc chọn toàn bộ rồi thay thế.
* Backspace xóa grapheme cuối; hỗ trợ xóa một cụm cuối bằng Ctrl/Option+Backspace khi trình duyệt cung cấp ý định xóa đó. Xóa không làm giảm bộ đếm các lần nhập trước đó.
* Không cho nhập thêm khi độ dài đã bằng bài. Nếu ký tự cuối sai, người dùng phải xóa rồi nhập lại mới hoàn thành. Lỗi ở vị trí trước có thể giữ nguyên và được phản ánh vào kết quả.
* Chặn paste, drop, autofill và thay thế hàng loạt ngoài composition; hiện thông báo ngắn, không phạt thêm lỗi. Tắt spellcheck, autocorrect và autocapitalize nếu môi trường hỗ trợ.
* Không chặn tổ hợp phím của hệ thống/trình duyệt. Tab giữ chức năng điều hướng. Esc mở Settings và làm gián đoạn lượt đang chạy.

### 7.3. Tiếng Việt và IME

* Trong `compositionstart` đến `compositionend`, hiển thị phần đang ghép tạm thời nhưng không tính lỗi, combo, tiến độ hoặc phát âm thanh cho từng phím ghép dấu.
* Khi composition kết thúc, xử lý chuỗi kết quả đã chuẩn hóa thành các grapheme được chốt. Đảm bảo cặp sự kiện `compositionend`/`input` không ghi nhận trùng.
* Composition có thể ghi nhận nhiều grapheme một lần; xử lý theo thứ tự tại cùng timestamp. Không nhầm commit của IME với paste.
* Timer bắt đầu tại lần input đầu tiên nếu đang `ready`; với composition đầu bài, bắt đầu từ `compositionstart` để tính cả thời gian ghép chữ. Composition bị hủy không sinh điểm; nếu chưa có commit nào thì reset timer về `ready`.
* Giữ focus ổn định, không remount textarea khi cập nhật điểm hay hiệu ứng. Kiểm tra thực tế Telex/VNI; nếu bộ gõ hệ điều hành gửi input theo cách khác thì xử lý qua adapter, không suy đoán nội dung từ key code.

## 8. Định nghĩa điểm, timer, combo và rank

### 8.1. Biến đo và công thức

* `elapsedMs`: thời gian từ bắt đầu đến commit cuối, dùng `performance.now()`; không dùng số lần tick của interval để cộng thời gian.
* `insertedTotal`: tổng số grapheme đã chốt vào bài, gồm cả những lần nhập sai và nhập lại sau khi xóa.
* `correctInsertions`: số grapheme nhập đúng tại thời điểm được chốt so với vị trí đích. Xóa rồi nhập đúng lại vẫn là một lần nhập mới.
* `correctFinal`: số grapheme đang khớp với bài tại các vị trí đã nhập. Đây là giá trị dùng cho WPM chính.
* `remainingErrors`: số vị trí đã nhập nhưng không khớp đích.
* `minutes = elapsedMs / 60000`.
* **WPM chính = `(correctFinal / 5) / minutes`.** Quy ước 5 ký tự tương đương một từ, gồm khoảng trắng; áp dụng cho cả hai ngôn ngữ.
* **Gross WPM = `(insertedTotal / 5) / minutes`.** Chỉ dùng trong chi tiết kết quả; gõ lại có thể làm chỉ số này tăng.
* **Accuracy = `correctInsertions / insertedTotal × 100`.** Lỗi đã sửa vẫn ảnh hưởng accuracy. Trước lần commit đầu hiển thị `—`.
* Không chia cho 0: WPM trước khi bắt đầu là 0; chưa đủ 1 giây thì live WPM hiển thị `—`. Kết quả cuối dùng thời gian thực, không tự làm tròn thời gian lên 1 giây.
* UI hiển thị WPM nguyên và accuracy một chữ số thập phân. Lưu số chưa làm tròn; so PB, rank bằng số chưa làm tròn.
* Biểu đồ lấy mẫu WPM tích lũy mỗi giây và thêm một điểm cuối khi kết thúc. Đây là tốc độ trung bình từ đầu bài đến thời điểm lấy mẫu.

### 8.2. Combo và rank

* Commit đúng: combo +1; commit sai: combo = 0. Mọi thao tác xóa làm combo = 0, không sinh thêm lỗi. Lưu `maxCombo`.
* Rank là nhãn động viên trong app, không phải chứng nhận tốc độ. Chọn mức cao nhất đáp ứng đồng thời hai ngưỡng:

| Rank | WPM tối thiểu | Accuracy tối thiểu |
| --- | ---: | ---: |
| S+ | 100 | 99% |
| S | 80 | 98% |
| A | 60 | 95% |
| B | 40 | 90% |
| C | Các lượt hoàn thành còn lại | — |

* Rank không thay đổi theo Ultra/Zen. Không xếp rank cho lượt bỏ dở hoặc nội dung dưới 150 grapheme.

## 9. History Vault, PB và Ghost Replay

### 9.1. Dữ liệu đề xuất

```ts
type ReplayEvent = { t: number; index: number; correctCount: number };
type Passage = {
  id: string; content: string; contentHash: string;
  language: 'en' | 'vi'; topic: string;
  source: 'sample' | 'ai'; createdAt: number;
  promptVersion: number;
};
type Attempt = {
  id: string; passageId: string; rulesVersion: number;
  status: 'completed' | 'abandoned'; startedAt: number;
  elapsedMs: number; insertedTotal: number; correctInsertions: number;
  correctFinal: number; remainingErrors: number; maxCombo: number;
  wpm: number; accuracy: number;
  replay: ReplayEvent[];
  samples: { t: number; wpm: number }[];
};
```

* `t` tính bằng mili giây tương đối từ lúc bắt đầu. `index` là vị trí nhập kế tiếp; mỗi commit hoặc xóa ghi một sự kiện sau khi cập nhật input. Không cần lưu phím bấm thô.
* IndexedDB có bảng `passages`, `attempts`, `meta`; index theo `passageId`, `createdAt`/`startedAt`. PB suy ra từ attempts, tránh lưu hai nguồn chân lý.
* Lưu bài mẫu/AI trước khi bắt đầu luyện. Kết quả ghi một lần theo `attemptId` bằng transaction; render lại hoặc Strict Mode không được tạo attempt trùng.
* Lượt bỏ dở lưu metadata nhưng không lưu replay. Giới hạn replay ở 20.000 sự kiện/lượt; vượt giới hạn thì vẫn đo điểm, đánh dấu lượt không có replay đầy đủ và không dùng làm Ghost.
* Nếu lưu thất bại: giữ kết quả trong bộ nhớ, báo rõ chưa lưu và cho thử lưu lại. Không báo lưu thành công giả.

### 9.2. PB và đồng bộ Ghost

* PB chỉ xét lượt `completed`, accuracy ≥95%, không còn lỗi, cùng `contentHash` và `rulesVersion`.
* So lần lượt: WPM cao hơn → accuracy cao hơn → `startedAt` sớm hơn. Các chủ đề/ngôn ngữ khác nhau không dùng chung PB.
* Ghost là lượt tốt nhất có replay đầy đủ trong nhóm đủ điều kiện PB. Nếu PB chính không có replay thì ghi rõ Ghost đang dùng lượt tốt nhất có replay.
* Chụp cố định lượt Ghost khi vào `ready`; hoàn thành lượt mới không thay ghost giữa bài.
* Ghost bắt đầu cùng đồng hồ của user, dùng `requestAnimationFrame` tra sự kiện gần nhất có `t <= elapsedMs`. Không tiến vị trí trước thời điểm sự kiện; có thể animate chuyển động ngắn giữa các vị trí đã đạt.
* Backspace trong replay khiến Ghost lùi lại. Layout thay đổi thì đo lại tọa độ từ index, không lưu tọa độ pixel trong database.
* Nếu Ghost về đích trước, giữ ở cuối bài. Chênh lệch hiển thị theo `correctFinal - ghost.correctCount`, ghi nhãn “ký tự đúng”.
* Không có lượt hợp lệ thì ẩn Ghost và ghi “Hoàn thành bài để tạo Ghost”. Retry miễn cooldown.

## 10. Sinh bài AI và quản lý cooldown

### 10.1. Luồng request

1. Người dùng chọn ngôn ngữ, chủ đề, độ dài rồi bấm Generate.
2. Nếu đang gõ, xác nhận bỏ lượt trước khi gọi API. Nếu đang cooldown hoặc có request chưa kết thúc, không gửi request mới.
3. Gửi POST tới route server cùng request ID và cấu hình đã kiểm tra. API key của chủ app chỉ tồn tại ở server.
4. Trong khi chờ, giữ bài cũ, khóa nút Generate và hiển thị trạng thái đang tạo. Có nút hủy request; hủy không bảo đảm nhà cung cấp dừng tính phí.
5. Server gọi LLM, timeout tổng 20 giây. Bản đầu dùng JSON hoàn chỉnh, chưa cần streaming vào engine.
6. Kiểm tra schema, chuẩn hóa NFC/khoảng trắng và kiểm tra độ dài. Chỉ đưa vào engine khi toàn bộ nội dung hợp lệ.
7. Lưu bài rồi chuyển sang `ready`. Reveal chỉ là lớp trang trí; cho bỏ qua, không để chữ giả đi vào dữ liệu bài.
8. Nếu lỗi hoặc timeout, giữ nguyên bài cũ, hiển thị lý do ngắn và cho dùng bài mẫu.

### 10.2. Ràng buộc nội dung

* Kết quả chỉ chứa `{ "text": "..." }`; không Markdown fence, HTML hoặc giải thích ngoài bài.
* Prompt yêu cầu đúng ngôn ngữ, chủ đề và khoảng độ dài; không chứa ký tự điều khiển, zero-width, tab, xuống dòng hoặc emoji ở bản đầu.
* Server kiểm tra kết quả thực tế, không tin tuyệt đối yêu cầu trong prompt. Không tự cắt chuỗi giữa một grapheme hay giữa câu để ép độ dài.
* Nội dung không hợp lệ trả lỗi có thể hiểu được. Không tự lặp gọi model vô hạn; bản đầu không tự retry sinh bài.
* Render nội dung bằng text node; không dùng `dangerouslySetInnerHTML`.
* Mỗi request có sequence ID; phản hồi của request cũ sau khi bị hủy hoặc thay thế không được ghi đè bài đang mở.

### 10.3. Cooldown và giới hạn server

* Mặc định 30 giây, tính từ thời điểm server nhận và chấp nhận request, kể cả request đó thất bại sau khi đã gọi nhà cung cấp. Request bị từ chối trước khi gọi nhà cung cấp không tạo cooldown mới.
* Server trả `nextAllowedAt`, `serverNow` và/hoặc `retryAfterMs`; client dùng thời gian còn lại để hiển thị, lưu `nextAllowedAt` giúp khôi phục sau F5. Trong một phiên dùng đồng hồ monotonic để đếm lùi.
* Client bị lỗi mạng không biết server đã nhận chưa: thử lại vẫn chịu giới hạn server. Response 429 cập nhật countdown theo server.
* `localStorage` là cache giao diện, không phải cơ chế chống lạm dụng. Hai tab đồng bộ countdown qua `storage` event hoặc BroadcastChannel.
* Bản public dùng key của chủ app cần rate limit phía server, quota ngân sách chung và giới hạn request đồng thời. Định danh anonymous có thể bị reset; kết hợp session, IP với ngưỡng cấu hình và quota tổng. Không khẳng định ngăn được mọi hành vi lạm dụng.
* Settings được chọn 30–60 giây như thời gian chờ cá nhân; không được thấp hơn mức sàn server. Bỏ tùy chọn 15 giây ở bản public. Giá trị thực tế là mức lớn hơn giữa giới hạn server và cài đặt cá nhân.
* Không lưu API key trong localStorage, IndexedDB, export hay log. Custom API Key tạm hoãn khỏi MVP; nếu bổ sung phải thiết kế riêng đường đi key và sự đồng ý gửi key tới backend.
* Cooldown hết khi `remainingMs <= 0`, UI không hiển thị số âm. Bấm khi cooldown chỉ phản hồi nhẹ, không gọi API.

## 11. Settings, âm thanh, hiệu ứng và hiệu năng

* Settings lưu localStorage có `schemaVersion`, validate khi đọc; dữ liệu hỏng thì về mặc định. Cài đặt thay đổi không làm mất bài đang chọn.
* Visuals: Lite/Ultra, bật Ghost, rung màn hình, comet trail; Acoustic: bật âm thanh, profile và volume 0–100%; AI: ngôn ngữ/chủ đề/độ dài/cooldown cá nhân; Data: export/import/xóa.
* Web Audio chỉ tạo/resume AudioContext sau thao tác người dùng. Mute có hiệu lực ngay; giới hạn số âm đồng thời và tái sử dụng audio graph.
* Âm thanh/particles được phát từ sự kiện commit của engine, không từ React render. Một commit composition nhiều chữ chỉ phát một âm và một đợt hiệu ứng giới hạn.
* Caret phải bám kịp vị trí nhập; spring nhẹ và thời lượng ngắn, không kéo dài độ trễ khi gõ nhanh. Tắt transition dài khi qua dòng.
* Giới hạn particles, ví dụ tối đa 120 hạt đồng thời; tái sử dụng pool. Canvas không nhận pointer event; giới hạn device pixel ratio ở 2.
* Chỉ dùng một vòng animation chính, dừng khi không còn hiệu ứng và khi tab ẩn. Cleanup listeners, audio nodes, animation frames khi unmount.
* Tránh cập nhật toàn bộ cây React theo từng frame: engine cập nhật input theo commit, metrics UI lấy mẫu khoảng 100ms, biểu đồ mỗi giây. Chỉ animate ký tự vừa thay đổi.
* Dùng ResizeObserver để đo lại caret khi đổi font, resize hoặc đổi dòng. Cuộn dòng đang gõ vào vùng nhìn thấy mà không giật toàn trang.
* Modal có focus trap, nhãn rõ ràng, đóng bằng Esc và trả focus. Không dùng màu làm tín hiệu duy nhất cho đúng/sai. Thông báo cho screen reader theo từng sự kiện lớn, không đọc điểm mỗi phím.
* Result xuất hiện sau khi kết quả đã khóa. Shockwave/confetti không được trì hoãn lưu kết quả; với reduced motion hiển thị kết quả ngay.

## 12. Export, Import và xóa dữ liệu

* Export JSON chứa `schemaVersion`, `exportedAt`, passages, attempts và settings không nhạy cảm. Không chứa key, token hoặc định danh rate limit.
* Import giới hạn 10MB, kiểm tra schema và giới hạn số bản ghi/sự kiện trước khi ghi database; chỉ chấp nhận các trường đã định nghĩa.
* Kiểm tra ID duy nhất, quan hệ passage/attempt, số hữu hạn không âm, replay có thời gian không giảm và index nằm trong bài. Tính lại metrics từ các bộ đếm; không tin WPM/rank nhập sẵn.
* File không hợp lệ bị từ chối toàn bộ với lý do; không nhập nửa chừng. File hợp lệ hiển thị số bài/lượt sắp thêm và yêu cầu xác nhận rồi ghi bằng transaction.
* Trùng ID và cùng nội dung thì bỏ qua; trùng ID nhưng khác nội dung thì cấp ID mới, remap liên kết attempts. Import không ghi đè dữ liệu hiện có.
* Dữ liệu import có nhãn nguồn nhập; PB chỉ mang ý nghĩa cá nhân, không dùng cho xếp hạng công khai.
* Xóa một bài sẽ xóa các attempts liên quan trong cùng transaction và yêu cầu xác nhận. “Xóa lịch sử” không xóa settings; “Khôi phục toàn bộ” xóa cả settings sau xác nhận riêng.
* IndexedDB không khả dụng/quota đầy: chuyển sang phiên tạm trong bộ nhớ, có banner rõ ràng và vẫn cho luyện bài mẫu. Không tự xóa lịch sử để giải phóng dung lượng.

## 13. Kiến trúc logic và trách nhiệm triển khai

* `engine/typingEngine.ts`: reducer/hàm thuần xử lý commit, xóa, hoàn thành và các bộ đếm; không phụ thuộc React, Canvas hay âm thanh.
* `engine/inputAdapter.ts`: textarea, composition, chặn paste/drop và chuyển sự kiện trình duyệt thành hành động engine.
* `engine/replayEngine.ts`: ghi và đọc timeline Ghost, độc lập với vị trí pixel.
* `utils/text.ts`: chuẩn hóa, tách grapheme, kiểm tra nội dung; dùng chung phía client/server khi phù hợp.
* `utils/calculations.ts`: metrics, PB và rank có version.
* `app/api/generate/route.ts`: kiểm tra request, rate limit, gọi nhà cung cấp và validate output. `llmService.ts` phía client chỉ gọi route này.
* `services/dbService.ts`: schema migrations, transaction, import/export. Không gọi database trực tiếp từ component hiển thị chữ.
* Zustand giữ snapshot engine và settings. Không để component tự tính lại một bộ metrics khác.
* Mọi API liên quan DB, Canvas, Audio, localStorage hoặc `window` chỉ chạy ở client sau khi môi trường sẵn sàng, tránh lỗi SSR/hydration.

## 14. Tình huống biên bắt buộc xử lý

| Tình huống | Hành vi mong muốn |
| --- | --- |
| Double-click Generate | Chỉ một request được gửi |
| F5 trong cooldown | Hiện thời gian còn lại, server vẫn chặn request sớm |
| Sửa đồng hồ máy | Không vượt giới hạn server; countdown sửa lại theo phản hồi server |
| AI lỗi/JSON sai/quá độ dài | Giữ bài cũ, báo lỗi, không đưa dữ liệu lỗi vào engine |
| Gõ sai rồi xóa sửa | Accuracy vẫn ghi nhận lỗi, WPM dựa trên trạng thái đúng hiện tại |
| Ký tự cuối sai | Chưa kết thúc, cho xóa và nhập lại |
| Chuyển tab hoặc mở Settings khi đang gõ | Lượt bỏ dở, chỉ có thể bắt đầu lại |
| Composition tiếng Việt | Không tính các phím ghép dấu thành lỗi riêng |
| Reload hoặc kết quả render hai lần | Không ghi attempt trùng |
| Xóa bài đang mở | Chuyển sang bài mẫu sau khi xóa thành công |
| Resize lúc Ghost đang chạy | Đúng vị trí ký tự theo layout mới |
| Ghi lịch sử thất bại | Hiện kết quả và trạng thái chưa lưu, cho thử lưu lại |

## 15. Tiêu chí nghiệm thu và kiểm thử

### 15.1. Kiểm thử logic tự động

* Ví dụ chuẩn: bài 250 grapheme, hoàn thành trong 60 giây, 250 lần nhập đúng → 50 WPM, accuracy 100%.
* Cùng bài, có 10 lần nhập sai đã xóa sửa: `insertedTotal = 260`, `correctInsertions = 250`, `correctFinal = 250` → 50 WPM, accuracy khoảng 96,15%, gross WPM 52.
* Kiểm tra lỗi chưa sửa, xóa ở đầu bài, ký tự cuối sai, commit nhiều grapheme, NFC và ký tự có dấu tổ hợp; không có NaN/Infinity.
* Kiểm tra PB theo cùng bài/luật, tie-break, không chọn lượt bỏ dở hoặc replay thiếu làm Ghost.
* Kiểm tra Ghost phát đúng timeline, có lùi khi xóa, và không chạy trước sự kiện.
* Kiểm tra import hỏng, ID xung đột, transaction thất bại; rate limit/cooldown server và phản hồi request cũ.

### 15.2. Kiểm tra trải nghiệm thực tế

* Luồng hoàn chỉnh: mở app → gõ bài mẫu → kết quả → retry cùng Ghost → tạo bài AI → history → export/import.
* Kiểm tra Telex/VNI trên Windows bằng bộ gõ thực, không chỉ bằng sự kiện mô phỏng. Kiểm tra bàn phím tiếng Anh, Backspace giữ phím, đổi focus và IME hủy composition.
* Kiểm tra phiên bản trình duyệt đang dùng của Chrome, Edge, Firefox và Safari nếu có thiết bị; ghi rõ môi trường đã kiểm tra, không tuyên bố hỗ trợ khi chưa xác minh.
* Đo Lite và Ultra trên một máy tham chiếu được ghi rõ. Mục tiêu xử lý engine dưới 4ms ở p95/commit và phần lớn frame dưới 16,7ms trên màn hình 60Hz. Input không chờ hiệu ứng kết thúc; giảm FX nếu máy không đạt.
* Kiểm tra reduced motion, chỉ bàn phím, zoom 200%, màn hình hẹp, IndexedDB bị chặn và mạng mất giữa request.

## 16. Thứ tự triển khai và prompt giao việc cho agent

1. Xây engine thuần, công thức, Unicode/input adapter và bộ kiểm thử logic trước.
2. Làm màn gõ bài mẫu, caret, kết quả và retry; xác minh tiếng Việt trước khi xây hiệu ứng.
3. Thêm Dexie, History, PB, Ghost, import/export và xử lý lỗi lưu trữ.
4. Thêm API sinh bài, validation, rate limit server, countdown đồng bộ nhiều tab và các trạng thái lỗi.
5. Thêm Settings, âm thanh và FX nhẹ; sau đó Ultra Juice, bàn phím ảo, reveal và confetti.
6. Chạy nghiệm thu toàn luồng và đo hiệu năng. Hoàn thiện lỗi trước khi bổ sung tính năng ngoài phạm vi.

> **Prompt triển khai:** Xây AuraType AI theo tài liệu này. Ưu tiên phần 6–16 khi khác phần mô tả concept. Hoàn thành lần lượt các giai đoạn, dùng một nguồn trạng thái cho engine và một bộ công thức metrics. Không thay logic bằng dữ liệu giả; nếu chưa cấu hình nhà cung cấp AI thì chế độ bài mẫu vẫn hoạt động và UI ghi rõ AI chưa sẵn sàng. Không đưa secret vào client hoặc commit. Chạy kiểm thử phù hợp, xác minh luồng sử dụng và báo rõ phần chưa kiểm tra. Không tự thêm tài khoản, thanh toán, bảng xếp hạng hay tính năng ngoài phạm vi.
