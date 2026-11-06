/* global AudioWorkletProcessor, registerProcessor */
// The live interview's capture worklet (#2362): hands each frame of the microphone's first
// channel to the page, which resamples it to 16 kHz PCM16. Plain JavaScript, because the browser
// loads a worklet module as it is.
class LiveCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel !== undefined && channel.length > 0) this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor("live-capture", LiveCapture);
