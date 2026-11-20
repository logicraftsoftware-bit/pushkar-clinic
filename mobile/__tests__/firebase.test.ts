jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
import {
  requestFirebaseOtp,
  confirmFirebaseOtp,
  clearFirebaseLogin,
  observeFirebaseOtp,
} from '../src/live/firebase';
const mockConfirm = jest.fn(),
  mockRequest = jest.fn(),
  mockToken = jest.fn(),
  mockSignOut = jest.fn(),
  mockObserve = jest.fn();
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({}),
  signInWithPhoneNumber: (...args: unknown[]) => mockRequest(...args),
  getIdToken: (...args: unknown[]) => mockToken(...args),
  onAuthStateChanged: (...args: unknown[]) => mockObserve(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
  mockRequest.mockResolvedValue({ confirm: mockConfirm });
  mockConfirm.mockResolvedValue({ user: { uid: 'synthetic' } });
  mockToken.mockResolvedValue('synthetic-signed-token');
});
test('Firebase SMS confirmation stays in memory and yields a signed token', async () => {
  await clearFirebaseLogin();
  await expect(confirmFirebaseOtp('123456')).rejects.toThrow(
    'Request a new OTP',
  );
  const challenge = await requestFirebaseOtp('+919999999999');
  expect(challenge.challenge_id).toBe('firebase');
  expect(mockRequest).toHaveBeenCalledWith({}, '+919999999999');
  expect(await confirmFirebaseOtp('123456')).toBe('synthetic-signed-token');
  expect(mockConfirm).toHaveBeenCalledWith('123456');
  await expect(confirmFirebaseOtp('123456')).rejects.toThrow(
    'Request a new OTP',
  );
  await requestFirebaseOtp('+919999999999');
  expect(mockRequest).toHaveBeenLastCalledWith({}, '+919999999999');
  await clearFirebaseLogin();
});

test('automatic verification accepts only the phone requested for this login', async () => {
  await requestFirebaseOtp('+919999999999');
  let callback: (user: unknown) => void = () => {};
  mockObserve.mockImplementation(
    (_auth: unknown, listener: (user: unknown) => void) => {
      callback = listener;
      return () => {};
    },
  );
  const complete = jest.fn();
  observeFirebaseOtp(complete);
  callback({ phoneNumber: '+918888888888' });
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  callback({ phoneNumber: '+919999999999' });
  await Promise.resolve();
  await Promise.resolve();
  expect(complete).toHaveBeenCalledWith('synthetic-signed-token');
  await clearFirebaseLogin();
  complete.mockClear();
  callback({ phoneNumber: '+919999999999' });
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
});
