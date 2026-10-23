// Device-local secret storage for the unlocked data key: Android Keystore via expo-secure-store.
import * as SecureStore from "expo-secure-store";

export const deviceGet = (name: string) => SecureStore.getItemAsync(name);
export const deviceSet = (name: string, value: string) => SecureStore.setItemAsync(name, value);
export const deviceRemove = (name: string) => SecureStore.deleteItemAsync(name);
