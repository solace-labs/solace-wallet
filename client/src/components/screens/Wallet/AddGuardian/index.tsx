import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  Alert,
} from 'react-native';
import React, {useContext, useState} from 'react';
import styles from './styles';

import AntDesign from 'react-native-vector-icons/AntDesign';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {GlobalContext} from '../../../../state/contexts/GlobalContext';
import {addNewContact} from '../../../../state/actions/global';

export type Props = {
  navigation: any;
};

const AddGuardian: React.FC<Props> = ({navigation}) => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const {dispatch} = useContext(GlobalContext);

  // const addContact = () => {
  //   if (name && address) {
  //     const newContact = {
  //       id: new Date().getTime().toString() + Math.random().toString(),
  //       name,
  //       address,
  //       username: `${name.split(' ')[0]}.solace.money`,
  //     };
  //     dispatch(addNewContact(newContact));
  //     navigation.navigate('Send');
  //   } else {
  //     Alert.alert('Please enter all the details');
  //   }
  // };

  return (
    <ScrollView contentContainerStyle={styles.contentContainer} bounces={false}>
      <View style={styles.headerContainer}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <AntDesign name="back" style={styles.icon} />
        </TouchableOpacity>
        <Text style={styles.mainText}>add manually</Text>
      </View>
      <View style={styles.inputContainer}>
        <TextInput
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          value={name}
          onChangeText={setName}
          style={styles.textInput}
          placeholderTextColor="#9999a5"
          placeholder="name"
        />
        <View style={styles.inputWrap}>
          <TextInput
            autoCapitalize="none"
            autoComplete="off"
            value={address}
            onChangeText={setAddress}
            autoCorrect={false}
            style={[styles.textInput, styles.textInputAddress]}
            placeholderTextColor="#9999a5"
            placeholder="solace or solana address"
          />
          <MaterialCommunityIcons name="line-scan" style={styles.scanIcon} />
        </View>
      </View>

      <View style={styles.subTextContainer}>
        <AntDesign name="checkcircleo" style={styles.subIcon} />
        <Text style={styles.subText}>address found</Text>
      </View>
      <View style={[styles.subTextContainer, {marginTop: 0}]}>
        <Text style={styles.buttonText}>0x8zo881ixpzAdiZ2802hz00zc</Text>
      </View>

      {/* <View style={styles.networkContainer}>
        <Text style={styles.secondText}>network</Text>
        <Text style={styles.solanaText}>solana</Text>
      </View> */}
      <View style={styles.endContainer}>
        <TouchableOpacity
          disabled={!name || !address}
          // onPress={() => addContact()}
          style={styles.buttonStyle}>
          <Text
            style={[
              styles.buttonTextStyle,
              {color: !name || !address ? '#9999a5' : 'black'},
            ]}>
            add guardian
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

export default AddGuardian;
