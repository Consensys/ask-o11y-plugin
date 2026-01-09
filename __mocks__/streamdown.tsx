import React from 'react';

// Mock implementation of Streamdown component for testing
export const Streamdown: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div data-testid="streamdown-mock">{children}</div>;
};

export default Streamdown;
