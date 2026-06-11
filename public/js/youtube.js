// YouTube IFrame Player API loader
window.YTReady = new Promise((resolve) => {
  window.onYouTubeIframeAPIReady = resolve;
});

// Load YouTube IFrame API
(function() {
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  const firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(tag, firstScript);
})();

class YTPlayer {
  constructor(containerId) {
    this.containerId = containerId;
    this.player = null;
    this.ready = false;
    this.pendingVideoId = null;
    this.onEndedCallback = null;
    this.onReadyCallback = null;
    this._init();
  }

  async _init() {
    await window.YTReady;
    this.player = new YT.Player(this.containerId, {
      width: '320', height: '180',
      playerVars: { autoplay: 0, controls: 0, rel: 0, fs: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          this.ready = true;
          if (this.pendingVideoId) {
            this.loadVideo(this.pendingVideoId);
            this.pendingVideoId = null;
          }
          if (this.onReadyCallback) this.onReadyCallback();
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED && this.onEndedCallback) {
            this.onEndedCallback();
          }
        }
      }
    });
  }

  loadVideo(videoId, autoplay = false) {
    if (!this.ready) { this.pendingVideoId = videoId; return; }
    if (autoplay) {
      this.player.loadVideoById(videoId);
    } else {
      this.player.cueVideoById(videoId);
    }
  }

  play() { if (this.ready) this.player.playVideo(); }
  pause() { if (this.ready) this.player.pauseVideo(); }

  seekTo(seconds) {
    if (this.ready) this.player.seekTo(seconds, true);
  }

  setVolume(vol) {
    if (this.ready) this.player.setVolume(vol);
  }

  getCurrentTime() {
    if (!this.ready) return 0;
    try { return this.player.getCurrentTime() || 0; } catch { return 0; }
  }

  getDuration() {
    if (!this.ready) return 0;
    try { return this.player.getDuration() || 0; } catch { return 0; }
  }

  getState() {
    if (!this.ready) return -1;
    try { return this.player.getPlayerState(); } catch { return -1; }
  }

  isPlaying() {
    return this.getState() === 1; // YT.PlayerState.PLAYING
  }
}

window.YTPlayer = YTPlayer;
