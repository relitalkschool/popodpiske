import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Typography, Modal } from 'antd';
import { useCheckPhoneMutation, useLoginMutation } from '../api/authApi';
import { useSendCodeMutation, useVerifyCodeMutation } from '../api/smsApi';
import { updateUserField, userCreated, userLoggedIn } from '../redux/slices/userSlice';
import InputMask from 'react-input-mask';
import { showNotification } from '../hooks/showNotification';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { setCourse } from '../redux/slices/courseSlice';
import useValidatePaymentLink from '../hooks/validateLink';
import SmsCodeInput from '../components/MailCodeInput';

const { Title } = Typography;

const Subscribe: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [smsForm] = Form.useForm(); // Form instance for the SMS modal
  const [step, setStep] = useState<'phone' | 'password'>('phone');
  const [phone, setPhone] = useState<string>('');
  const [smsModalVisible, setSmsModalVisible] = useState(false);

  // SMS mutations from RTK Query
  const [sendSMS] = useSendCodeMutation();
  const [verifySMS] = useVerifyCodeMutation();

  // State for SMS resend logic in the modal.
  // "codeSent" indicates whether the countdown is running.
  const [codeSent, setCodeSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const [clearError, setClearError] = useState(false);

  const [checkPhone] = useCheckPhoneMutation();
  const [login] = useLoginMutation();

  const [searchParams] = useSearchParams();
  const linkId = searchParams.get('id') || ''; // Will be '' if not provided

  const token = localStorage.getItem("access_token");
  const { user, isLoggedIn } = useAppSelector(state => state.userReducer);

  // Use the validation hook only if linkId exists.
  const { isValid, data, component } = useValidatePaymentLink(linkId);

  // On mount, restore phone from localStorage if available.
  useEffect(() => {
    const storedPhone = localStorage.getItem("userPhone");
    if (storedPhone) {
      setPhone(storedPhone);
    }
  }, []);

  // Restore modal open state if it was open before a page reload.
  useEffect(() => {
    const modalVisible = localStorage.getItem("smsModalVisible");
    if (modalVisible === "true") {
      setSmsModalVisible(true);
    }
  }, []);

  // If linkId is present, dispatch course info and navigate accordingly.
  useEffect(() => {
    if (!linkId) {
      if (user && isLoggedIn && token) {
        navigate('/dashboard');
      }
    } else if (user && isLoggedIn && token && data && isValid) {
      dispatch(setCourse({
        courseName: data?.course.courseName,
        totalPrice: Number(data?.course.totalPrice),
        monthsArray: data?.monthsArray,
        paymentLink: linkId,
      }));
      // Clear temporary data before redirecting
      localStorage.removeItem("userPhone");
      localStorage.removeItem("smsSentTimestamp");
      localStorage.removeItem("smsModalVisible");
      navigate("/personal-info");
    }
  }, [user, isLoggedIn, token, data, linkId, isValid, dispatch, navigate]);

  const handlePhoneSubmit = async (values: { phone: string }) => {
    try {
      let phoneNumber = values.phone.replace(/[^0-9+]/g, '');
      if (phoneNumber.length > 12) phoneNumber = phoneNumber.slice(0, 12);

      const response = await checkPhone({ phone: phoneNumber }).unwrap();
      // Store the phone number in localStorage so it persists after reload.
      localStorage.setItem("userPhone", phoneNumber);
      setPhone(phoneNumber);
      if (response.exists) {
        setStep('password');
      } else {
        dispatch(updateUserField({ key: 'phone', value: phoneNumber }));
        if (linkId) {
          dispatch(setCourse({
            courseName: data?.course.courseName,
            totalPrice: Number(data?.course.totalPrice),
            monthsArray: data?.monthsArray,
            paymentLink: linkId,
          }));
          // Clear temporary data before redirecting
          localStorage.removeItem("userPhone");
          localStorage.removeItem("smsSentTimestamp");
          localStorage.removeItem("smsModalVisible");
          navigate('/personal-info');
        } else {
          // Clear temporary data before redirecting
          localStorage.removeItem("userPhone");
          localStorage.removeItem("smsSentTimestamp");
          localStorage.removeItem("smsModalVisible");
          navigate('/dashboard');
        }
      }
    } catch (e: any) {
      showNotification('error', 'Произошла ошибка', e.data?.message || 'Не предвиденная ошибка, попробуйте позже');
    }
  };

  const handleLoginSubmit = async (values: { password: string }) => {
    try {
      let phoneFormatted = phone.replace(/[^0-9+]/g, '');
      if (phoneFormatted.length > 12) phoneFormatted = phoneFormatted.slice(0, 12);

      const response = await login({ phone: phoneFormatted, password: values.password }).unwrap();
      localStorage.setItem("access_token", response.accessToken);
      dispatch(userCreated(response.user));
      dispatch(userLoggedIn(true));
      if (linkId) {
        dispatch(setCourse({
          courseName: data?.course.courseName,
          totalPrice: data?.course.totalPrice,
          monthsArray: data?.monthsArray,
          paymentLink: linkId,
        }));
        // Clear temporary data before redirecting
        localStorage.removeItem("userPhone");
        localStorage.removeItem("smsSentTimestamp");
        localStorage.removeItem("smsModalVisible");
        navigate('/personal-info');
      } else {
        // Clear temporary data before redirecting
        localStorage.removeItem("userPhone");
        localStorage.removeItem("smsSentTimestamp");
        localStorage.removeItem("smsModalVisible");
        navigate('/dashboard');
      }
    } catch (e: any) {
      showNotification('error', e.data?.message || 'Не предвиденная ошибка, попробуйте позже');
    }
  };

  // Timer logic for the resend button in the modal.
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (codeSent) {
      interval = setInterval(() => {
        setTimer((prev) => {
          if (prev === 1) {
            setCodeSent(false); // Timer finished; enable resend.
            clearInterval(interval!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [codeSent]);

  // When the SMS modal becomes visible, check for an existing timestamp.
  useEffect(() => {
    if (smsModalVisible) {
      const smsSentTimestamp = localStorage.getItem('smsSentTimestamp');
      const now = Date.now();
      if (smsSentTimestamp) {
        const secondsPassed = Math.floor((now - parseInt(smsSentTimestamp, 10)) / 1000);
        if (secondsPassed < 60) {
          // Resume the timer with the remaining time.
          setTimer(60 - secondsPassed);
          setCodeSent(true);
          return;
        }
      }
      // Otherwise, send a new code automatically.
      sendNewCode();
    }
  }, [smsModalVisible]);

  // Function to handle sending a new code.
  const sendNewCode = async () => {
    const smsSentTimestamp = localStorage.getItem('smsSentTimestamp');
    const now = Date.now();
    if (smsSentTimestamp) {
      const secondsPassed = Math.floor((now - parseInt(smsSentTimestamp, 10)) / 1000);
      if (secondsPassed < 60) {
        setTimer(60 - secondsPassed);
        setCodeSent(true);
        return;
      }
    }
    try {
      let phoneFormatted = phone;
      if (!phoneFormatted) {
        // Retrieve phone from localStorage if it's not in state.
        phoneFormatted = localStorage.getItem("userPhone") || "";
      }
      if (phoneFormatted.length > 12) phoneFormatted = phoneFormatted.slice(0, 12);
      await sendSMS({ phone: phoneFormatted }).unwrap();
      localStorage.setItem('smsSentTimestamp', String(now));
      setCodeSent(true);
      setTimer(60);
    } catch (e: any) {
      setClearError(true);
      showNotification('error', e.data?.message || 'Ошибка при отправке SMS');
    }
  };

  // ---------- SMS Modal handlers ----------
  const handleSmsFinish = async (values: any) => {
    try {
      let phoneFormatted = phone;
      if (!phoneFormatted) {
        phoneFormatted = localStorage.getItem("userPhone") || "";
      }
      if (phoneFormatted.length > 12) phoneFormatted = phoneFormatted.slice(0, 12);
      const response = await verifySMS({ code: values.code, phone: phoneFormatted }).unwrap();
      showNotification('success', 'Код подтвержден');
      setSmsModalVisible(false);
      // Clear all temporary data after successful SMS verification.
      localStorage.removeItem("smsModalVisible");
      localStorage.removeItem("smsSentTimestamp");
      localStorage.removeItem("userPhone");
      const queryParams = new URLSearchParams();
      queryParams.set('token', response.token);
      queryParams.set('phone', response.phone);
      queryParams.set('destination', linkId ? `/login?id=${linkId}` : '/login');
      navigate(`/reset?${queryParams.toString()}`);
    } catch (e: any) {
      showNotification('error', e.data?.message || 'Ошибка верификации SMS');
    }
  };

  const handleSmsComplete = (code: string) => {
    smsForm.setFieldsValue({ code });
    smsForm.submit();
  };

  return (
    <>
      {/* If linkId is absent, skip the validation component and course dispatch */}
      {linkId === '' ? null : (!isValid ? component : null)}

      <div className="flex justify-center items-center min-h-screen w-full">
        <div className="flex flex-col justify-center w-full max-w-lg mx-auto p-10 bg-white shadow-lg rounded-2xl space-y-6">
          <Title level={1} className="mx-auto font-rubik">Popodpiske</Title>
          <Form
            form={form}
            onFinish={(values) => {
              if (step === 'phone') {
                handlePhoneSubmit(values);
              } else {
                handleLoginSubmit(values);
              }
            }}
            layout="vertical"
          >
            {step === 'phone' && (
              <Form.Item
                name="phone"
                label="Номер телефона"
                validateFirst
                rules={[
                  {
                    required: true,
                    message: 'Пожалуйста, введите номер телефона',
                  },
                  {
                    validator: async (_, value) => {
                      const stripped = value?.replace(/[^\d+]/g, '') || '';
                      if (stripped.length < 12) {
                        throw new Error('Номер должен содержать минимум 12 символов');
                      }
                    },
                  },
                ]}
                validateTrigger="onBlur"
              >
                <InputMask mask="+7 (999) 999-99-99" maskChar={null}>
                  {(inputProps: any) => <Input {...inputProps} size="large" placeholder="Введите номер телефона" />}
                </InputMask>
              </Form.Item>
            )}
            {step === 'password' && (
              <>
                <Form.Item
                  name="password"
                  label="Пароль"
                  rules={[{ required: true, message: 'Пожалуйста, введите пароль' }]}
                >
                  <Input.Password size="large" placeholder="Введите пароль" />
                </Form.Item>
                <Form.Item className="flex items-center justify-center mx-auto">
                  <Button
                    type="link"
                    onClick={async () => {
                      try {
                        await sendNewCode();
                        setSmsModalVisible(true);
                        localStorage.setItem("smsModalVisible", "true");
                      } catch (e: any) {
                        showNotification("error", e?.data?.message || "Произошла ошибка, попробуйте позже");
                      }
                    }}
                  >
                    Забыли пароль?
                  </Button>
                </Form.Item>
              </>
            )}
            <Form.Item>
              <Button className="w-full mt-3" type="primary" htmlType="submit" size="large">
                {step === 'phone' ? 'Далее' : 'Войти'}
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>

      {/* SMS Modal */}
      <Modal
        title="Подтверждение телефона"
        visible={smsModalVisible}
        onCancel={() => {
          setSmsModalVisible(false);
          localStorage.removeItem("smsModalVisible");
        }}
        footer={null}
      >
        <Form
          form={smsForm}
          layout="vertical"
          onFinish={handleSmsFinish}
          initialValues={{ code: '' }}
          className="mt-6"
        >
          <Form.Item
            name="code"
            label="Введите код из SMS"
            rules={[{ required: true, message: 'Пожалуйста, введите код' }]}
          >
            <SmsCodeInput
              length={5}
              onComplete={handleSmsComplete}
              clearError={clearError}
            />
          </Form.Item>

          <Form.Item>
            <p className="w-full text-center text-gray-600">
              Код будет отправлен на номер {phone}
            </p>
          </Form.Item>

          <Form.Item>
            <Button
              type="link"
              disabled={codeSent}
              onClick={sendNewCode}
              className="w-full text-center"
            >
              {codeSent ? `Повторная отправка через ${timer}с` : 'Получить новый код'}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default Subscribe;