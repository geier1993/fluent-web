import { mapBundleSync } from "@fluent/sequence";
import { CachedSyncIterable } from "cached-iterable/compat";

const MESSAGE_ID_ATTRIBUTE = "messageId";

class FluentElement extends HTMLElement {
  getMessage({ messageId, args, whitelist = [] }) {
    const bundles = this._bundles || this._providerBundles;
    if (bundles) {
      const bundle = mapBundleSync(bundles, messageId);

      if (bundle) {
        const message = bundle.getMessage(messageId);

        if (message) {
          const formatted = { value: null, attributes: {} };
          let errors = [];

          if (message.value) {
            formatted.value = bundle.formatPattern(message.value, args, errors);
          }

          Object.entries(message.attributes).forEach(([name, value]) => {
            if (whitelist.includes(name)) {
              formatted.attributes[name] = bundle.formatPattern(value, args, errors);
            }
          });

          if (errors.length > 0) {
            const errorEvent = new CustomEvent("fluent-web-error", {
              bubbles: true,
              detail: {
                messageId,
                args,
                message,
                errors,
              },
            });
            this.dispatchEvent(errorEvent);
          }

          return formatted;
        } else {
          const errorEvent = new CustomEvent("fluent-web-error", {
            bubbles: true,
            detail: {
              messageId,
              args,
              errors: [new Error("Message object not found")],
            },
          });
          this.dispatchEvent(errorEvent);
        }
      }
    }

    return null;
  }

  connectedCallback() {
    this.dispatchEvent(
      new CustomEvent("fluent-bundles-subscribe", {
        bubbles: true,
        target: this,
      })
    );
    this.render();
  }
  disconnectedCallback() {
    this.dispatchEvent(
      new CustomEvent("fluent-bundles-unsubscribe", {
        bubbles: true,
        target: this,
      })
    );
  }

  set providerBundles(newBundles) {
    this._providerBundles = cacheBundles(this, newBundles);
    this.render();
  }

  set bundles(newBundles) {
    this._bundles = cacheBundles(this, newBundles);
    this.render();
  }

  set attributeWhitelist(whitelist) {
    this.whitelist = whitelist;
    this.render();
  }

  set args(newValue) {
    this.messageArgs = newValue;
    this.render();
  }

  static get observedAttributes() {
    return [MESSAGE_ID_ATTRIBUTE];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === MESSAGE_ID_ATTRIBUTE && oldValue !== newValue) {
      this.render();
    }
  }
}

class FluentProvider extends HTMLElement {
  constructor() {
    super();
    this._listeners = [];
  }
  connectedCallback() {
    this._listeners = [];
    this.addEventListener("fluent-bundles-subscribe", bundlesSubscribe);
    this.addEventListener("fluent-bundles-unsubscribe", bundlesUnsubscribe);
  }
  disconnectedCallback() {
    this._listeners = [];
    this.removeEventListener("fluent-bundles-subscribe", bundlesSubscribe);
    this.removeEventListener("fluent-bundles-unsubscribe", bundlesUnsubscribe);
  }
  get bundles() {
    return this._bundles;
  }
  set bundles(newBundles) {
    this._bundles = cacheBundles(this, newBundles);
    this._listeners.forEach((target) => {
      target.providerBundles = this._bundles;
    });
  }
}
function bundlesSubscribe(event) {
  const provider = event.currentTarget;
  provider._listeners.push(event.target);
  event.target.providerBundles = provider._bundles;
}
function bundlesUnsubscribe(event) {
  const provider = event.currentTarget;
  const i = provider._listeners.findIndex(event.target);
  if (i >= 0) {
    provider._listeners.splice(i, 1);
  }
}

function cacheBundles(el, bundles) {
  // Allow iterables (usually an array) or null
  if (bundles) {
    // Already cached, don't cache it twice
    if (bundles.constructor === CachedSyncIterable) {
      return bundles;
    }
    // Iterable check: https://stackoverflow.com/a/32538867/2782048
    if (typeof bundles[Symbol.iterator] === "function") {
      return CachedSyncIterable.from(bundles);
    }
  }
  if (bundles !== null) {
    el.dispatchEvent(
      new CustomEvent("fluent-web-error", {
        bubbles: true,
        detail: {
          bundles,
          errors: [new Error("bundles property must be iterable or null")],
        },
      }),
    );
  }
  return null;
}

function semiSafeInnerHTML(el, message) {
  if (message.value && message.value !== "{???}") {
    const template = document.createElement("template");
    template.innerHTML = message.value;
    el.innerHTML = "";
    Array.from(template.content.childNodes).forEach((node) => {
      el.appendChild(node);
    });
  }
}

customElements.define(
  "fluent-text",
  class extends FluentElement {
    render() {
      const message = this.getMessage({
        messageId: this.getAttribute(MESSAGE_ID_ATTRIBUTE),
        args: this.messageArgs,
      });

      if (message) {
        semiSafeInnerHTML(this, message);
      }
    }
  }
);

customElements.define(
  "fluent-element",
  class extends FluentElement {
    render() {
      if (this.firstElementChild) {
        const message = this.getMessage({
          messageId: this.getAttribute(MESSAGE_ID_ATTRIBUTE),
          args: this.messageArgs,
          whitelist: this.whitelist
        });

        if (message) {
          Object.entries(message.attributes).forEach(([name, value]) => {
            this.firstElementChild.setAttribute(name, value);
          });

          semiSafeInnerHTML(this.firstElementChild, message);
        }
      }
    }
  }
);

customElements.define("fluent-provider", FluentProvider);
