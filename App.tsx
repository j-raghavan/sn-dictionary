import React from 'react';
import {StyleSheet, View} from 'react-native';

export default function App(): React.JSX.Element {
  return <View pointerEvents="none" style={styles.hidden} />;
}

const styles = StyleSheet.create({
  hidden: {width: 0, height: 0},
});
