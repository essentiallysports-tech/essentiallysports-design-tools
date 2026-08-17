// Runs on-device Whisper transcription off the main thread so a long clip
// never trips the browser's "page unresponsive" hang watchdog.
var TRANSFORMERS_MODULE_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',
  'https://unpkg.com/@huggingface/transformers@3.8.1',
];
var LOCAL_WHISPER_MODEL = 'Xenova/whisper-tiny.en';

var transcriberPromise = null;

async function importTransformersModule() {
  var lastError = null;
  for (var i = 0; i < TRANSFORMERS_MODULE_URLS.length; i++) {
    try {
      return await import(/* webpackIgnore: true */ TRANSFORMERS_MODULE_URLS[i]);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not load on-device Whisper.');
}

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = importTransformersModule().then(function (module) {
      if (module.env) {
        module.env.allowLocalModels = false;
        module.env.allowRemoteModels = true;
      }
      return module.pipeline('automatic-speech-recognition', LOCAL_WHISPER_MODEL, {
        dtype: 'q4',
        progress_callback: function (progress) {
          if (progress && progress.status === 'progress' && Number.isFinite(progress.progress)) {
            self.postMessage({ type: 'progress', progress: progress.progress });
          }
        },
      });
    });
  }
  return transcriberPromise;
}

self.onmessage = async function (event) {
  var data = event.data || {};
  var id = data.id;
  try {
    var transcriber = await getTranscriber();
    var result = await transcriber(data.samples, { return_timestamps: 'word' });
    self.postMessage({ id: id, type: 'result', text: result.text, chunks: result.chunks || [] });
  } catch (error) {
    self.postMessage({ id: id, type: 'error', message: (error && error.message) || String(error) });
  }
};
