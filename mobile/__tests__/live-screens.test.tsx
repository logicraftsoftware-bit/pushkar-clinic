import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { PatientProvider } from '../src/live/PatientContext';
import { liveScreens } from '../src/live/screens';
import { api } from '../src/live/native';
const mockNavigate = jest.fn();
jest.mock('../src/live/native', () => ({
  api: {
    restore: jest.fn(),
    request: jest.fn(),
    onExpired: () => {},
    clear: jest.fn(),
  },
  chooseFile: jest.fn(),
  downloadDocument: jest.fn(),
}));
jest.mock('react-native-razorpay', () => ({ open: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    navigate: mockNavigate,
    canGoBack: () => false,
    reset: jest.fn(),
  }),
  useFocusEffect: (callback: () => void) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-linear-gradient', () => ({
  __esModule: true,
  default: require('react-native').View,
}));
jest.mock('react-native-qrcode-svg', () => ({
  __esModule: true,
  default: require('react-native').View,
}));
beforeEach(() => {
  jest.clearAllMocks();
  (api.restore as jest.Mock).mockResolvedValue(false);
});
test('SMS-disabled login remains disabled while guest browsing works', async () => {
  (api.request as jest.Mock).mockResolvedValue({ sms_login_configured: false });
  let tree: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <PatientProvider>
        <liveScreens.Welcome />
      </PatientProvider>,
    );
  });
  const send = tree!.root
    .findAllByProps({ accessibilityLabel: 'Send OTP' })
    .find(node => node.props.accessibilityRole === 'button');
  expect(send?.props.disabled).toBe(true);
  const guest = tree!.root
    .findAllByProps({ accessibilityLabel: 'Browse clinics without signing in' })
    .find(node => node.props.accessibilityRole === 'button');
  await act(async () => guest!.props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('Clinics');
  expect(JSON.stringify(tree!.toJSON())).not.toContain('528471');
  await act(async () => tree!.unmount());
});
test('private record screen never fetches patient records without authentication', async () => {
  let tree: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <PatientProvider>
        <liveScreens.Records />
      </PatientProvider>,
    );
  });
  expect(api.request).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).toContain('Sign in to continue');
  await act(async () => tree!.unmount());
});
test('authenticated home displays API appointments rather than demo patients', async () => {
  (api.restore as jest.Mock).mockResolvedValue(true);
  (api.request as jest.Mock).mockImplementation(async (path: string) =>
    path === '/me'
      ? {
          profile: { id: 'profile', name: 'Synthetic Patient' },
          phone: '+910000000000',
          self_profile_id: 'profile',
        }
      : {
          upcoming_appointments: [
            {
              id: 'visit',
              doctor_name: 'Dr. Synthetic',
              appointment_date: '2026-11-20',
              appointment_time: '09:00',
              status: 'Booked',
            },
          ],
          unread_notifications: 0,
        },
  );
  let tree: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <PatientProvider>
        <liveScreens.Home />
      </PatientProvider>,
    );
  });
  expect(JSON.stringify(tree!.toJSON())).toContain('Dr. Synthetic');
  expect(JSON.stringify(tree!.toJSON())).not.toContain('Dwaipayan');
  await act(async () => tree!.unmount());
});
