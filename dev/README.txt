Test scripts (Playwright + local tesseract CLI). Not loaded by the app.
Scripts expect the repo served at http://localhost:8765 and a scratch dir; edit DIR paths at the top.
ocr-sim.py makes fake phone-camera frames from epic-sample.jpg; simtest.js scores the OCR on them.
