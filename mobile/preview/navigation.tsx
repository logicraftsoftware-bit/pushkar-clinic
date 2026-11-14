import { createContext, useContext } from 'react';
import type { Navigation } from '../src/navigation';
export const PreviewNavigation = createContext<Navigation | null>(null);
export function useIsFocused() {
  return true;
}
export function useNavigation<T>() {
  return useContext(PreviewNavigation) as T;
}
