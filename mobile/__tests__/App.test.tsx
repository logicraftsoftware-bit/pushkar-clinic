import React from 'react';
import { Alert } from 'react-native';
import Renderer, { act } from 'react-test-renderer';
import { DemoProvider, useDemo } from '../src/data/DemoContext';
import { screens } from '../src/screens';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useNavigation: () => ({
    navigate: mockNavigate,
    canGoBack: () => false,
    goBack: jest.fn(),
    reset: jest.fn(),
  }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native-linear-gradient', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});

beforeEach(() => {
  jest.useFakeTimers();
  mockNavigate.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

test.each(Object.entries(screens))(
  '%s renders with offline sample data',
  async (_name, Component) => {
    let tree: Renderer.ReactTestRenderer;
    await act(async () => {
      tree = Renderer.create(
        <DemoProvider>
          <Component />
        </DemoProvider>,
      );
    });
    expect(tree!.toJSON()).toBeTruthy();
    await act(async () => tree!.unmount());
  },
);

test('changing booking selections is shared across the flow; payment needs demo confirmation', async () => {
  let state: ReturnType<typeof useDemo>;
  function Probe() {
    state = useDemo();
    return null;
  }
  let tree: Renderer.ReactTestRenderer;
  const confirm = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => {
    tree = Renderer.create(
      <DemoProvider>
        <Probe />
        <screens.Payment />
      </DemoProvider>,
    );
  });
  await act(async () => {
    state!.setDoctorIndex(1);
    state!.setPatient('Sananda Das');
    state!.setDay('14');
    state!.setTime('12:00 PM');
    state!.setBooked(false);
  });
  expect(state!.doctor.name).toBe('Dr. Priyanka Roy');
  expect(state!.patient).toBe('Sananda Das');
  expect(state!.day).toBe('14');
  const button = tree!.root.findAll(
    node => node.props.accessibilityLabel === 'Pay ₹520',
  )[0];
  await act(async () => button.props.onPress());
  expect(state!.booked).toBe(false);
  const buttons = confirm.mock.calls[0][2]!;
  await act(async () => buttons[1].onPress!());
  expect(state!.booked).toBe(true);
  expect(mockNavigate).toHaveBeenCalledWith('Confirmation');
  await act(async () => tree!.unmount());
  confirm.mockRestore();
});
