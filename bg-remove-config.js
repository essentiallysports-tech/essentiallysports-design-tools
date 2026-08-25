(function () {
  'use strict';

  // FrameUp is a static site with no build/env step, so this file stands in
  // for an environment variable: point apiBase at wherever the FastAPI
  // background-removal service (bg-remove-service/) is actually running.
  // Local dev default: `uvicorn app:app --port 8000` in bg-remove-service/.
  window.BG_REMOVE_CONFIG = Object.freeze({
    apiBase: 'http://localhost:8000',
  });
})();
