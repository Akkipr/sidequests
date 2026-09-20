import { Alert, Linking } from 'react-native';

// Opens a web page in the phone's browser. Only http(s) links are ever opened, whatever the server sends.
export async function openWebLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open the link', url);
  }
}
