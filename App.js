/* eslint-disable react-native/no-inline-styles */
import React, { useState, useRef } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Share,
  Image,
} from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  MediaStream,
  mediaDevices,
} from 'react-native-webrtc';
import firestore from '@react-native-firebase/firestore';
import { Button, TextInput } from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import Toast from 'react-native-simple-toast';
import AppColors from './assets/AppColors';

const App = () => {
  const [remoteStream, setRemoteStream] = useState(null);
  const [webcamStarted, setWebcamStarted] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [channelId, setChannelId] = useState(null);
  const [canBeginCall, setCanBeginCall] = useState(false);
  const pc = useRef();
  const servers = {
    iceServers: [
      {
        urls: [
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
        ],
      },
    ],
    iceCandidatePoolSize: 10,
  };

  const startWebcam = async () => {
    pc.current = new RTCPeerConnection(servers);
    const local = await mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    pc.current.addStream(local);
    setLocalStream(local);
    const remote = new MediaStream();
    setRemoteStream(remote);

    // Push tracks from local stream to peer connection
    local.getTracks().forEach(track => {
      console.log(pc.current.getLocalStreams());
      pc.current.getLocalStreams()[0].addTrack(track);
    });

    // Pull tracks from remote stream, add to video stream
    pc.current.ontrack = event => {
      event.streams[0].getTracks().forEach(track => {
        remote.addTrack(track);
      });
    };

    pc.current.onaddstream = event => {
      setRemoteStream(event.stream);
    };

    setWebcamStarted(true);
  };

  const startCall = async () => {
    const channelDoc = firestore().collection('channels').doc();
    const offerCandidates = channelDoc.collection('offerCandidates');
    const answerCandidates = channelDoc.collection('answerCandidates');

    setChannelId(channelDoc.id);

    pc.current.onicecandidate = async event => {
      if (event.candidate) {
        await offerCandidates.add(event.candidate.toJSON());
      }
    };

    //create offer
    const offerDescription = await pc.current.createOffer();
    await pc.current.setLocalDescription(offerDescription);

    const offer = {
      sdp: offerDescription.sdp,
      type: offerDescription.type,
    };

    await channelDoc.set({ offer });

    // Listen for remote answer
    channelDoc.onSnapshot(snapshot => {
      const data = snapshot.data();
      if (!pc.current.currentRemoteDescription && data?.answer) {
        const answerDescription = new RTCSessionDescription(data.answer);
        pc.current.setRemoteDescription(answerDescription);
      }
    });

    // When answered, add candidate to peer connection
    answerCandidates.onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const data = change.doc.data();
          pc.current.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
  };

  const joinCall = async () => {
    if (channelId) {
      setCanBeginCall(true);
      const channelDoc = firestore().collection('channels').doc(channelId);
      const offerCandidates = channelDoc.collection('offerCandidates');
      const answerCandidates = channelDoc.collection('answerCandidates');

      pc.current.onicecandidate = async event => {
        if (event.candidate) {
          await answerCandidates.add(event.candidate.toJSON());
        }
      };

      const channelDocument = await channelDoc.get();
      const channelData = channelDocument.data();

      const offerDescription = channelData.offer;

      await pc.current.setRemoteDescription(
        new RTCSessionDescription(offerDescription),
      );

      const answerDescription = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answerDescription);

      const answer = {
        type: answerDescription.type,
        sdp: answerDescription.sdp,
      };

      await channelDoc.update({ answer });

      offerCandidates.onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            pc.current.addIceCandidate(new RTCIceCandidate(data));
          }
        });
      });
    } else {
      Toast.show('Enter a Call ID to join the call!', Toast.CENTER, Toast.LONG);
    }
  };

  const endCall = async () => {
    let local = await mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    local.getTracks().map(track => track.stop());
    let remote = new MediaStream();
    remote.getTracks().map(track => track.stop());
    remote = null;
    pc.current._unregisterEvents();
    pc.current.close();
    pc.current = null;

    setChannelId(null);
    setLocalStream(null);
    setRemoteStream(null);
    setCanBeginCall(false);
    setWebcamStarted(false);
  };

  const initialiazeCallAfterKeyGeneration = () => {
    if (channelId) {
      setCanBeginCall(true);
    } else {
      Toast.show(
        'Generate a Call ID to start a call',
        Toast.CENTER,
        Toast.LONG,
      );
    }
  };

  const copyToClipBoard = async () => {
    try {
      if (channelId) {
        Clipboard.setString(channelId);
        Toast.show('Call ID copied!');
        const result = await Share.share({
          message: `Hey, join meeting by using this Meeting ID: ${channelId}`,
        });
        if (result.action === Share.sharedAction) {
          if (result.activityType) {
            // shared with activity type of result.activityType
          } else {
            // shared
          }
        } else if (result.action === Share.dismissedAction) {
          // dismissed
        }
      } else {
        Toast.show('Please create a Meeting Call ID first!');
        return;
      }
    } catch (error) {
      Toast.show(error.message);
    }
  };

  return (
    <SafeAreaView style={styles.body}>
      {canBeginCall && (
        <ScrollView>
          {localStream && canBeginCall && (
            <RTCView
              streamURL={localStream?.toURL()}
              style={styles.stream}
              objectFit="cover"
              mirror
            />
          )}

          {remoteStream && canBeginCall && (
            <RTCView
              streamURL={remoteStream?.toURL()}
              style={styles.stream}
              objectFit="cover"
              mirror
            />
          )}

          <Button
            theme={{ colors: { primary: 'red' } }}
            mode="contained"
            onPress={endCall}
            style={{ marginVertical: 10 }}>
            End Call
          </Button>
        </ScrollView>
      )}

      <View>
        {!webcamStarted && (
          <>
            <View style={styles.logoContainer}>
              <Image
                source={require('./assets/rn-webrtc-logo.png')}
                style={styles.logo}
              />
            </View>
            <Button
              theme={{ colors: { primary: AppColors.primary } }}
              mode="contained"
              onPress={startWebcam}>
              Get started
            </Button>
            <Text style={styles.getStartedText}>
              By using this app, you agree to allow the app to use your Camera
              and Microphone.
            </Text>
          </>
        )}
        {webcamStarted && !canBeginCall && (
          <>
            <View style={styles.logoCallContainer}>
              <Image
                source={require('./assets/rn-webrtc-logo.png')}
                style={styles.logoCall}
              />
            </View>
            <Text style={styles.infoText}>
              Generate a call ID and share it to start a call.
            </Text>
            <Button
              theme={{ colors: { primary: AppColors.secondary } }}
              mode="text"
              icon="phone-dial-outline"
              onPress={startCall}
              style={styles.buttons}>
              Create Call ID
            </Button>
            <TextInput
              mode="outlined"
              label="Meeting Call ID"
              value={channelId}
              placeholder="Meeting Call ID"
              minLength={45}
              style={{ color: AppColors.text }}
              onChangeText={newText => setChannelId(newText)}
              right={
                <TextInput.Icon
                  name="content-copy"
                  color={AppColors.text}
                  onPress={copyToClipBoard}
                />
              }
            />
            {channelId && (
              <Text style={styles.meetingCodeCopyText}>
                Use the icon at the right to copy and share your Meeting Call ID
              </Text>
            )}
            <Button
              theme={{ colors: { primary: AppColors.primary } }}
              mode="contained"
              disabled={!channelId}
              onPress={initialiazeCallAfterKeyGeneration}
              style={styles.buttons}>
              Start Call
            </Button>
            <Text
              style={[
                styles.text,
                { alignSelf: 'center', fontWeight: 'bold' },
              ]}>
              OR
            </Text>
            <Text style={styles.infoText}>
              Use the Call ID shared with you to join a call.
            </Text>
          </>
        )}
        {webcamStarted && !canBeginCall && (
          <View>
            <TextInput
              mode="outlined"
              label="Enter Call ID"
              value={channelId}
              minLength={45}
              style={{ color: AppColors.text }}
              onChangeText={newText => setChannelId(newText)}
            />
            <Button
              theme={{ colors: { primary: AppColors.tertiary } }}
              mode="contained"
              disabled={!channelId}
              onPress={joinCall}
              style={styles.buttons}>
              Join Call
            </Button>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
    backgroundColor: AppColors.background,
    justifyContent: 'center',
    padding: 20,
  },
  getStartedText: {
    color: AppColors.text,
    fontSize: 14,
    paddingVertical: 15,
    textAlign: 'center',
  },
  infoText: { color: AppColors.text, fontSize: 16 },
  meetingCodeCopyText: {
    color: AppColors.text,
    fontSize: 14,
    paddingVertical: 10,
  },
  stream: {
    flex: 1,
    width: '100%',
    height: 350,
    padding: 0,
  },
  buttons: {
    padding: 5,
    marginVertical: 10,
    color: AppColors.background,
  },
  text: {
    color: AppColors.text,
    fontSize: 16,
    paddingVertical: 10,
  },
  logoContainer: {
    alignItems: 'center',
    margin: 25,
  },
  logo: {
    width: 150,
    height: 150,
  },
  logoCallContainer: {
    alignItems: 'center',
    margin: 25,
  },
  logoCall: {
    width: 100,
    height: 100,
    position: 'absolute',
    top: -120,
  },
});

export default App;
