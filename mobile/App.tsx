import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PatientProvider } from './src/live/PatientContext';
import { liveScreens as screens } from './src/live/screens';
import type { Routes } from './src/navigation';
const Stack = createNativeStackNavigator<Routes>();
export default function App() {
  return (
    <SafeAreaProvider>
      <PatientProvider>
        <StatusBar barStyle="light-content" />
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
            }}
          >
            {Object.entries(screens).map(([name, component]) => (
              <Stack.Screen
                key={name}
                name={name as keyof Routes}
                component={component}
              />
            ))}
          </Stack.Navigator>
        </NavigationContainer>
      </PatientProvider>
    </SafeAreaProvider>
  );
}
