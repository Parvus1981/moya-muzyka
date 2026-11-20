# Модели и библиотеки для вырезки человека (работают на устройстве, без интернета после первой загрузки)

- `modnet.onnx` — MODNet: Trimap-Free Portrait Matting in Real Time (Zhanghan Ke и др.). Веса: https://github.com/ZHKKKe/MODNet, лицензия Apache-2.0. ONNX-экспорт: https://huggingface.co/Xenova/modnet (`onnx/model.onnx`), без изменений.
- `ort.wasm.min.js`, `ort-wasm-simd-threaded.*` — ONNX Runtime Web 1.22.0 (Microsoft), лицензия MIT: https://github.com/microsoft/onnxruntime
