/** jsdom doesn't implement <dialog> modality; mirror the `open` attribute a browser would set. */
export function polyfillDialog() {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
}
