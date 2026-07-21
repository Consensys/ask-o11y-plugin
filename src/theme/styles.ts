import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getHoverButtonStyle = (theme: GrafanaTheme2) =>
  css({
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  });
