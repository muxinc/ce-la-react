import type TReactDOM from 'react-dom/client';
import { test } from 'zora';
import { type WebComponentProps, createComponent } from '../src/ce-la-react.js';

declare global {
  // @ts-ignore
  var ReactDOM: typeof TReactDOM;
}

declare global {
  interface HTMLElementTagNameMap {
    'my-profile': MyProfile;
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'my-profile': WebComponentProps<MyProfile>;
    }
  }
}

class MyProfile extends HTMLElement {
  static shadowRootOptions = { mode: 'open' };

  static get observedAttributes() {
    return ['firstname', 'age', 'human'];
  }

  static getTemplateHTML(attrs: Record<string, string>) {
    return `<h1>Hello, ${attrs.firstname}!</h1>`;
  }

  #isInit = false;
  #metadata = {};

  connectedCallback() {
    this.#init();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    this.#init();

    if (oldValue === newValue) return;

    if (name === 'firstname') {
      this.render();
      queueMicrotask(() => {
        this.dispatchEvent(new CustomEvent('firstname'));
      });
    }
  }

  render() {
    if (this.shadowRoot) {
      this.shadowRoot.innerHTML = MyProfile.getTemplateHTML({
        ...namedNodeMapToObject(this.attributes),
      });
    }
  }

  #init() {
    if (this.#isInit) return;
    this.#isInit = true;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.render();
    }
  }

  get firstName() {
    return this.getAttribute('firstname');
  }

  set firstName(value) {
    if (value != null) this.setAttribute('firstname', value);
    else this.removeAttribute('firstname');
  }

  get age() {
    const age = this.getAttribute('age');
    return age ? Number.parseInt(age) : null;
  }

  set age(value) {
    if (value != null) this.setAttribute('age', `${value}`);
    else this.removeAttribute('age');
  }

  get human() {
    return this.hasAttribute('human');
  }

  set human(value) {
    this.toggleAttribute('human', !!value);
  }

  get metadata() {
    return this.#metadata;
  }

  set metadata(value) {
    this.#metadata = value;
  }
}

globalThis.customElements.define('my-profile', MyProfile);

function namedNodeMapToObject(namedNodeMap: NamedNodeMap) {
  const obj: Record<string, string> = {};
  for (const attr of namedNodeMap) {
    obj[attr.name] = attr.value;
  }
  return obj;
}

const CustomElementComponent = createComponent({
  react: globalThis.React,
  tagName: 'my-profile',
  elementClass: MyProfile,
  events: {
    onFirstName: 'firstname',
  },
});

test('renders a custom element', async (t) => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = globalThis.ReactDOM.createRoot(container);
  const metadata = { foo: 'bar' };

  const ref: { current: MyProfile | null } = { current: null };
  let firstNameEventCount = 0;

  console.time('render');
  try {
    await globalThis.React.act(async () => {
      root.render(
        globalThis.React.createElement(
          CustomElementComponent,
          {
            suppressHydrationWarning: true,
            ref,
            metadata,
            onFirstName: () => {
              firstNameEventCount++;
            },

            firstName: 'Wesley',
            age: 38,
            human: true,
            className: 'my-class',
            style: { color: 'lightseagreen' },
            tabIndex: 0,
          },
          globalThis.React.createElement('div', null, 'Children')
        )
      );
    });
  } catch (err) {
    console.error(err);
  }
  console.timeEnd('render');

  t.eq(
    container.innerHTML,
    '<my-profile firstname="Wesley" age="38" human="" class="my-class" tabindex="0" style="color: lightseagreen;"><div>Children</div></my-profile>'
  );

  t.eq(container.querySelector('my-profile')?.shadowRoot?.innerHTML, '<h1>Hello, Wesley!</h1>');

  t.eq(container.querySelector('my-profile')?.metadata, metadata);

  t.eq(ref?.current, container.querySelector('my-profile'));

  t.eq(firstNameEventCount, 1);
});
