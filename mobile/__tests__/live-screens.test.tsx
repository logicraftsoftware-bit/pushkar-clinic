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
    save: jest.fn(),
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
test('password login is the initial screen and offers no guest entry', async () => {
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
    .findAllByProps({ accessibilityLabel: 'Login' })
    .find(node => node.props.accessibilityRole === 'button');
  expect(send?.props.disabled).toBe(true);
  expect(
    tree!.root.findAllByProps({
      accessibilityLabel: 'Browse clinics without signing in',
    }),
  ).toHaveLength(0);
  expect(mockNavigate).not.toHaveBeenCalledWith('Clinics');
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

async function authScreen() {
  (api.request as jest.Mock).mockImplementation(async (path: string) =>
    path === '/me'
      ? {
          profile: { id: 'self', name: 'New Patient' },
          phone: '+919999999999',
          self_profile_id: 'self',
        }
      : path === '/auth/otp/request'
      ? { challenge_id: 'test-challenge', resend_after: 60 }
      : path === '/auth/otp/verify'
      ? { access_token: 'verified', refresh_token: 'refresh', expires_in: 900 }
      : { access_token: 'password', refresh_token: 'refresh', expires_in: 900 },
  );
  let tree: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      <PatientProvider>
        <liveScreens.Welcome />
      </PatientProvider>,
    );
  });
  const press = async (label: string) => {
    const node = tree!.root
      .findAllByProps({ accessibilityLabel: label })
      .find(n => n.props.accessibilityRole === 'button');
    expect(node).toBeDefined();
    await act(async () => node!.props.onPress());
  };
  const fill = async (label: string, value: string) => {
    const node = tree!.root
      .findAllByProps({ accessibilityLabel: label })
      .find(n => n.props.onChangeText);
    expect(node).toBeDefined();
    await act(async () => node!.props.onChangeText(value));
  };
  return { tree: tree!, press, fill };
}
test('password login exchanges credentials and opens the authenticated account', async () => {
  const page = await authScreen();
  await page.fill('Mobile number', '9999999999');
  await page.fill('Password', 'Synthetic-password-123');
  await page.press('Login');
  expect(api.request).toHaveBeenCalledWith(
    '/auth/password/login',
    'POST',
    { phone: '+919999999999', password: 'Synthetic-password-123' },
    { public: true },
  );
  expect(api.save).toHaveBeenCalled();
  await act(async () => page.tree.unmount());
});
test('registration verifies its OTP and signs in immediately', async () => {
  const page = await authScreen();
  await page.press('Register / Create Account');
  await page.fill('Full name', 'New Patient');
  await page.fill('Mobile number', '9999999999');
  await page.fill('Password', 'Synthetic-password-123');
  await page.press('Send OTP');
  expect(api.request).toHaveBeenCalledWith(
    '/auth/otp/request',
    'POST',
    expect.objectContaining({ purpose: 'register', name: 'New Patient' }),
    { public: true },
  );
  await page.fill('Six-digit OTP', '123456');
  await page.press('Verify & create account');
  expect(api.save).toHaveBeenCalled();
  await act(async () => page.tree.unmount());
});
test('forgot password verifies OTP before accepting a new password and signing in', async () => {
  const page = await authScreen();
  await page.press('Forgot password?');
  await page.fill('Mobile number', '9999999999');
  await page.press('Send OTP');
  (api.request as jest.Mock).mockImplementation(async (path: string) =>
    path === '/auth/otp/verify'
      ? { reset_token: 'test-reset' }
      : path === '/me'
      ? { profile: { id: 'self', name: 'New Patient' } }
      : { access_token: 'new', refresh_token: 'refresh', expires_in: 900 },
  );
  await page.fill('Six-digit OTP', '123456');
  await page.press('Verify OTP');
  await page.fill('New password', 'Synthetic-new-password-123');
  await page.fill('Confirm new password', 'Synthetic-new-password-123');
  await page.press('Save password & login');
  expect(api.request).toHaveBeenCalledWith(
    '/auth/password/reset',
    'POST',
    { reset_token: 'test-reset', password: 'Synthetic-new-password-123' },
    { public: true },
  );
  expect(api.save).toHaveBeenCalled();
  await act(async () => page.tree.unmount());
});
test('OTP login requests the login purpose and signs in after verification', async () => {
  const page = await authScreen();
  await page.press('Login with OTP');
  await page.fill('Mobile number', '9999999999');
  await page.press('Send OTP');
  await page.fill('Six-digit OTP', '123456');
  await page.press('Verify & login');
  expect(api.request).toHaveBeenCalledWith(
    '/auth/otp/request',
    'POST',
    { phone: '+919999999999', purpose: 'login' },
    { public: true },
  );
  expect(api.save).toHaveBeenCalled();
  await act(async () => page.tree.unmount());
});
