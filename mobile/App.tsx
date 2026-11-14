import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DemoProvider } from './src/data/DemoContext';
import { screens } from './src/screens';
import type { Routes } from './src/navigation';
const Stack = createNativeStackNavigator<Routes>();
export default function App() {
  return (
    <SafeAreaProvider>
      <DemoProvider>
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
      </DemoProvider>
    </SafeAreaProvider>
  );
}
