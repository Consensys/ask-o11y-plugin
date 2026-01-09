import { prefixRoute } from '../utils.routing';
import { PLUGIN_BASE_URL } from '../../constants';

describe('utils.routing', () => {
  describe('prefixRoute', () => {
    it('should prefix route with plugin base URL', () => {
      const result = prefixRoute('home');
      expect(result).toBe(`${PLUGIN_BASE_URL}/home`);
    });

    it('should handle empty route', () => {
      const result = prefixRoute('');
      expect(result).toBe(`${PLUGIN_BASE_URL}/`);
    });

    it('should handle route with slashes', () => {
      const result = prefixRoute('some/nested/path');
      expect(result).toBe(`${PLUGIN_BASE_URL}/some/nested/path`);
    });
  });
});

