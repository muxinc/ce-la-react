/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Modified version of `@lit/react` for vanilla custom elements with support for SSR.
 */

import type React from 'react';
type TReact = typeof React;

/**
 * Creates a type to be used for the props of a web component used directly in
 * React JSX.
 *
 * Example:
 *
 * ```ts
 * declare module "react" {
 *   namespace JSX {
 *     interface IntrinsicElements {
 *       'x-foo': WebComponentProps<XFoo>;
 *     }
 *   }
 * }
 * ```
 */
export type WebComponentProps<I extends HTMLElement> = React.DetailedHTMLProps<
  React.HTMLAttributes<I>,
  I
> &
  ElementProps<I>;

// Props derived from custom element class. Currently has limitations of making
// all properties optional and also surfaces life cycle methods in autocomplete.
// TODO(augustjk) Consider omitting keyof LitElement to remove "internal"
// lifecycle methods or allow user to explicitly provide props.
type ElementProps<I> = Partial<Omit<I, keyof HTMLElement>>;

// Acceptable props to the React component.
type ComponentProps<I, E extends EventNames> = Omit<
  React.HTMLAttributes<I>,
  // Prefer type of provided event handler props or those on element over
  // built-in HTMLAttributes
  keyof E | keyof ElementProps<I>
> &
  EventListeners<E> &
  ElementProps<I>;

/**
 * Type used to cast an event name with an event type when providing the
 * `events` option to `createComponent` for better typing of the event handler
 * prop.
 *
 * Example:
 *
 * ```ts
 * const FooComponent = createComponent({
 *   ...
 *   events: {
 *     onfoo: 'foo' as EventName<FooEvent>,
 *   }
 * });
 * ```
 *
 * `onfoo` prop will have the type `(e: FooEvent) => void`.
 */
export type EventName<T extends Event = Event> = string & {
  __eventType: T;
};

// A key value map matching React prop names to event names.
type EventNames = Record<string, EventName | string>;

// A map of expected event listener types based on EventNames.
type EventListeners<R extends EventNames> = {
  [K in keyof R]?: R[K] extends EventName ? (e: R[K]['__eventType']) => void : (e: Event) => void;
};

type CustomElementConstructor<T> = {
  getTemplateHTML?: (attrs: Record<string, string>) => string;
  shadowRootOptions?: {
    mode?: string;
    delegatesFocus?: boolean;
  };
  observedAttributes?: string[];
  new (): T;
};

export interface AttributeOptions {
  toAttributeName: (propName: string) => string;
  toAttributeValue: (propValue: unknown) => string | undefined;
}

const reservedReactProps = new Set([
  'style',
  'children',
  'ref',
  'key',
  'suppressContentEditableWarning',
  'suppressHydrationWarning',
  'dangerouslySetInnerHTML',
]);

const reactPropToAttrNameMap: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
};

function defaultToAttributeName(propName: string) {
  return propName.toLowerCase();
}

function defaultToAttributeValue(propValue: unknown) {
  if (typeof propValue === 'boolean') return propValue ? '' : undefined;
  if (typeof propValue === 'function') return undefined;
  if (typeof propValue === 'object' && propValue !== null) return undefined;
  return `${propValue}`;
}

export interface Options<I extends HTMLElement, E extends EventNames>
  extends Partial<AttributeOptions> {
  react: TReact;
  tagName: string;
  elementClass: CustomElementConstructor<I>;
  events?: E;
  displayName?: string;
}

export function createComponent<I extends HTMLElement, E extends EventNames>({
  react: React,
  tagName,
  elementClass,
  events,
  displayName,
  toAttributeName = defaultToAttributeName,
  toAttributeValue = defaultToAttributeValue,
}: Options<I, E>) {
  // React 19 supports custom elements and setting properties directly on them,
  // older React versions converted all props to attributes on custom elements.
  //
  // Boolean `true` values should not be converted to empty strings in React 19+
  // because that would result in a `false` value if it was set via a property.
  //
  // React 19+ handles primitive values and events correctly but the camelCase
  // prop names still need converting to the correct attribute name format.
  // e.g. playbackId => playback-id
  const IS_REACT_19_OR_NEWER = Number.parseInt(React.version) >= 19;

  type Props = ComponentProps<I, E>;

  const ReactComponent = React.forwardRef<I, Props>((props, ref) => {
    const elementRef = React.useRef<I | null>(null);
    const prevElemPropsRef = React.useRef(new Map());

    // Events to be set on element with addEventListener
    const eventProps: Record<string, (e: Event) => void> = {};
    // Attributes to be passed to getTemplateHTML
    const attrs: Record<string, string> = {};
    // Props to be passed to React.createElement
    const reactProps: Record<string, unknown> = {};
    // Props to be set on element with setProperty
    const elementProps: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(props)) {
      if (reservedReactProps.has(k)) {
        reactProps[k] = v;
        continue;
      }

      const attrName = toAttributeName(reactPropToAttrNameMap[k] ?? k);

      // Prefer attributes over properties for SSR.
      // If the attribute is listed in observedAttributes, it's likely
      // a primitive value that should be set as an attribute and will
      // internally be reflected to the accompanying property.
      if (
        k in elementClass.prototype &&
        !(k in HTMLElement.prototype) &&
        !elementClass.observedAttributes?.some((attr) => attr === attrName)
      ) {
        elementProps[k] = v;
        continue;
      }

      if (k.startsWith('on')) {
        eventProps[k] = v;
        continue;
      }

      const attrValue = IS_REACT_19_OR_NEWER ? v : toAttributeValue(v);
      if (attrName && attrValue !== undefined) {
        attrs[attrName] = attrValue;
        reactProps[attrName] = attrValue;
      }
    }

    // useLayoutEffect produces warnings during server rendering.
    if (typeof window !== 'undefined') {
      // Set up event listeners on the custom element.
      // Only for React 18 and older, React 19+ handles events correctly.
      for (const propName in eventProps) {
        const callback = eventProps[propName as keyof typeof eventProps];
        const useCapture = propName.endsWith('Capture');
        const eventName = (events?.[propName] ?? propName.slice(2).toLowerCase()).slice(
          0,
          useCapture ? -7 : undefined
        );

        React.useLayoutEffect(() => {
          const eventTarget = elementRef?.current;
          if (!eventTarget || typeof callback !== 'function') return;

          eventTarget.addEventListener(eventName, callback, useCapture);

          return () => {
            eventTarget.removeEventListener(eventName, callback, useCapture);
          };
        }, [elementRef?.current, callback]);
      }

      // Set up properties on the custom element.
      // This one has no dependency array so it'll run on every re-render.
      React.useLayoutEffect(() => {
        if (elementRef.current === null) return;

        const newElemProps = new Map();
        for (const key in elementProps) {
          setProperty(elementRef.current, key, elementProps[key]);
          prevElemPropsRef.current.delete(key);
          newElemProps.set(key, elementProps[key]);
        }
        // "Unset" any props from previous render that no longer exist.
        // Setting to `undefined` seems like the correct thing to "unset"
        // but currently React will set it as `null`.
        // See https://github.com/facebook/react/issues/28203
        for (const [key, _value] of prevElemPropsRef.current) {
          setProperty(elementRef.current, key, undefined);
        }
        prevElemPropsRef.current = newElemProps;
      });
    }

    // Only render the custom element template HTML on the server..
    // The custom element will render itself on the client.
    if (
      typeof window === 'undefined' &&
      elementClass?.getTemplateHTML &&
      elementClass?.shadowRootOptions
    ) {
      const { mode, delegatesFocus } = elementClass.shadowRootOptions;

      const templateShadowRoot = React.createElement('template', {
        shadowrootmode: mode,
        shadowrootdelegatesfocus: delegatesFocus,
        dangerouslySetInnerHTML: {
          __html: elementClass.getTemplateHTML(attrs),
        },
      });

      reactProps.children = [templateShadowRoot, reactProps.children];
    }

    return React.createElement(tagName, {
      ...reactProps,
      ref: React.useCallback(
        (node: I) => {
          elementRef.current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref !== null) {
            ref.current = node;
          }
        },
        [ref]
      ),
    });
  });

  ReactComponent.displayName = displayName ?? elementClass.name;

  return ReactComponent;
}

/**
 * Sets properties and events on custom elements. These properties and events
 * have been pre-filtered so we know they should apply to the custom element.
 */
function setProperty<E extends Element>(node: E, name: string, value: unknown) {
  node[name as keyof E] = value as E[keyof E];

  // This block is to replicate React's behavior for attributes of native
  // elements where `undefined` or `null` values result in attributes being
  // removed.
  // https://github.com/facebook/react/blob/899cb95f52cc83ab5ca1eb1e268c909d3f0961e7/packages/react-dom-bindings/src/client/DOMPropertyOperations.js#L107-L141
  //
  // It's only needed here for native HTMLElement properties that reflect
  // attributes of the same name but don't have that behavior like "id" or
  // "draggable".
  if (value == null && name in HTMLElement.prototype) {
    node.removeAttribute(name);
  }
}
