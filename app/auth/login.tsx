import { Redirect } from 'expo-router';

export default function AuthLoginAlias() {
  return <Redirect href="/(auth)/login" />;
}
