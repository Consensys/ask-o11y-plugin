import React from 'react';

type JSXRuntimeProps = Record<string, unknown> | null | undefined;

export const Fragment = React.Fragment;

function createElement(type: React.ElementType, props: JSXRuntimeProps, key?: React.Key): React.ReactElement {
  const elementProps = props == null ? {} : { ...props };

  if (key !== undefined) {
    elementProps.key = key;
  }

  return React.createElement(type, elementProps);
}

export const jsx = createElement;
export const jsxs = createElement;
export const jsxDEV = createElement;
