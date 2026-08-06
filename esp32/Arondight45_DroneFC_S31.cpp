/*
 * Arondight45 DroneFC — ESP32-S31 / ESP-IDF master
 * Reference stack: ICM-42688-P SPI+DRDY 1 kHz, inverted SBUS 100k 8E2,
 * Quad-X, four 400 Hz PWM ESCs. Boots disarmed. No Wi-Fi/flash/heap/logging
 * in the armed loop. Host tests: g++ -std=c++17 -O2 -Wall -Wextra -Werror
 * -DFC_HOST_TEST this_file.cpp -o fc_test && ./fc_test
 *
 * Default pins: IMU MOSI11 MISO12 SCLK13 CS10 DRDY9, SBUS8, M1..M4=4..7.
 * Build target must be esp32s31. Override FC_PIN_* and FC_IMU_ROTATION.
 * M1 FL CCW, M2 FR CW, M3 RR CCW, M4 RL CW.
 * Remove props for all first-power and direction tests. Airframe-specific PID
 * verification remains mandatory; software cannot infer wiring or mechanics.
 */
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

#ifndef FC_SBUS_ROLL
#define FC_SBUS_ROLL 0
#endif
#ifndef FC_SBUS_PITCH
#define FC_SBUS_PITCH 1
#endif
#ifndef FC_SBUS_THROTTLE
#define FC_SBUS_THROTTLE 2
#endif
#ifndef FC_SBUS_YAW
#define FC_SBUS_YAW 3
#endif
#ifndef FC_SBUS_ARM
#define FC_SBUS_ARM 4
#endif

namespace fc {
static_assert(FC_SBUS_ROLL>=0&&FC_SBUS_ROLL<16&&FC_SBUS_PITCH>=0&&FC_SBUS_PITCH<16&&FC_SBUS_THROTTLE>=0&&FC_SBUS_THROTTLE<16&&FC_SBUS_YAW>=0&&FC_SBUS_YAW<16&&FC_SBUS_ARM>=0&&FC_SBUS_ARM<16);
constexpr float pi=3.14159265358979323846f;
template<class T> constexpr T clamp(T v,T lo,T hi){return v<lo?lo:(v>hi?hi:v);}
struct V3{float x{},y{},z{};};
inline float mag(V3 v){return std::sqrt(v.x*v.x+v.y*v.y+v.z*v.z);}
inline bool finite(V3 v){return std::isfinite(v.x)&&std::isfinite(v.y)&&std::isfinite(v.z);}
struct Imu{V3 a{},g{};};

class PT1{
 float fc_,y_{}; bool init_{};
public:
 explicit PT1(float f):fc_(f){}
 float run(float x,float dt){
  if(!init_||!(dt>0)||!std::isfinite(dt)){y_=x;init_=true;return y_;}
  float rc=1.0f/(2*pi*fc_),k=clamp(dt/(rc+dt),0.0f,1.0f); y_+=k*(x-y_); return y_;
 }
 void reset(){y_=0;init_=false;}
};
struct Filters{
 std::array<PT1,3> g{PT1(100),PT1(100),PT1(100)},a{PT1(30),PT1(30),PT1(30)};
 Imu run(Imu s,float dt){return {{a[0].run(s.a.x,dt),a[1].run(s.a.y,dt),a[2].run(s.a.z,dt)},
                                {g[0].run(s.g.x,dt),g[1].run(s.g.y,dt),g[2].run(s.g.z,dt)}};}
};
struct Att{
 float r{},p{},y{};
 void reset(V3 a){r=std::atan2(a.y,a.z)*180/pi;p=std::atan2(-a.x,std::sqrt(a.y*a.y+a.z*a.z))*180/pi;y=0;}
 void run(Imu s,float dt){
  r+=s.g.x*dt;p+=s.g.y*dt;y+=s.g.z*dt; if(y>180)y-=360;if(y<-180)y+=360;
  float n=mag(s.a); if(n>.8f&&n<1.2f){
   float ar=std::atan2(s.a.y,s.a.z)*180/pi,ap=std::atan2(-s.a.x,std::sqrt(s.a.y*s.a.y+s.a.z*s.a.z))*180/pi;
   float tau=1/(2*pi*1.4f),k=clamp(dt/(tau+dt),0.0f,.02f);r+=k*(ar-r);p+=k*(ap-p);
  }
 }
};
struct Gains{float kp,ki,kd,ilim,olim,df;};
class PID{
 Gains q_; PT1 df_; float i_{},prev_{}; bool have_{};
public:
 explicit PID(Gains q):q_(q),df_(q.df){}
 float run(float sp,float m,float dt,bool integ){
  if(!(dt>0)||!std::isfinite(sp)||!std::isfinite(m))return 0;
  float e=sp-m,d=have_?-(m-prev_)/dt:0;prev_=m;have_=true;d=df_.run(d,dt);
  float u=q_.kp*e+i_+q_.kd*d;
  if(integ&&!((u>=q_.olim&&e>0)||(u<=-q_.olim&&e<0)))i_=clamp(i_+q_.ki*e*dt,-q_.ilim,q_.ilim);
  return clamp(q_.kp*e+i_+q_.kd*d,-q_.olim,q_.olim);
 }
 void reset(){i_=prev_=0;have_=false;df_.reset();}
 float integral()const{return i_;}
};

struct RC{std::array<uint16_t,16> ch{};bool lost{},fs{},valid{};uint64_t us{};};
inline bool sbus_end(uint8_t b){return b==0||b==4||b==0x14||b==0x24||b==0x34;}
inline bool decode(const uint8_t*p,RC&o){
 if(!p||p[0]!=0x0f||!sbus_end(p[24]))return false;
 o.ch[0]=(p[1]|p[2]<<8)&0x7ff;o.ch[1]=(p[2]>>3|p[3]<<5)&0x7ff;o.ch[2]=(p[3]>>6|p[4]<<2|p[5]<<10)&0x7ff;
 o.ch[3]=(p[5]>>1|p[6]<<7)&0x7ff;o.ch[4]=(p[6]>>4|p[7]<<4)&0x7ff;o.ch[5]=(p[7]>>7|p[8]<<1|p[9]<<9)&0x7ff;
 o.ch[6]=(p[9]>>2|p[10]<<6)&0x7ff;o.ch[7]=(p[10]>>5|p[11]<<3)&0x7ff;o.ch[8]=(p[12]|p[13]<<8)&0x7ff;
 o.ch[9]=(p[13]>>3|p[14]<<5)&0x7ff;o.ch[10]=(p[14]>>6|p[15]<<2|p[16]<<10)&0x7ff;o.ch[11]=(p[16]>>1|p[17]<<7)&0x7ff;
 o.ch[12]=(p[17]>>4|p[18]<<4)&0x7ff;o.ch[13]=(p[18]>>7|p[19]<<1|p[20]<<9)&0x7ff;o.ch[14]=(p[20]>>2|p[21]<<6)&0x7ff;o.ch[15]=(p[21]>>5|p[22]<<3)&0x7ff;
 o.lost=p[23]&4;o.fs=p[23]&8;o.valid=!o.lost&&!o.fs;return true;
}
class Sbus{
 std::array<uint8_t,25>b_{};size_t n_{};uint64_t last_{};
public:
 bool feed(uint8_t b,uint64_t us,RC&o){
  if(n_&&us>last_&&us-last_>3000){n_=0;} last_=us;
  if(!n_){if(b!=0x0f)return false;b_[n_++]=b;return false;}b_[n_++]=b;if(n_<25)return false;n_=0;
  if(decode(b_.data(),o)){o.us=us;return true;}
  for(size_t i=1;i<25;i++){if(b_[i]==0x0f){size_t k=25-i;std::memmove(b_.data(),b_.data()+i,k);n_=k;break;}} return false;
 }
};
inline float centered(uint16_t v){return clamp((float(v)-992)/820,-1.0f,1.0f);}
inline float throttle(uint16_t v){return clamp((float(v)-172)/(1811-172),0.0f,1.0f);}
inline float shape(float x,float db,float expo){float a=std::fabs(x);if(a<=db)return 0;float t=(a-db)/(1-db),v=t*(1-expo)+t*t*t*expo;return std::copysign(clamp(v,0.0f,1.0f),x);}
struct Cmd{float r{},p{},t{},y{};bool arm{};};
inline Cmd command(const RC&r){return {shape(centered(r.ch[FC_SBUS_ROLL]),.035f,.3f),-shape(centered(r.ch[FC_SBUS_PITCH]),.035f,.3f),throttle(r.ch[FC_SBUS_THROTTLE]),shape(centered(r.ch[FC_SBUS_YAW]),.045f,.2f),r.ch[FC_SBUS_ARM]>1300};}
struct Mix{std::array<float,4>m{};};
inline Mix mix(float t,float r,float p,float y){
 t=clamp(t,0.0f,1.0f);std::array<float,4>c{{p-r-.65f*y,p+r+.65f*y,-p+r-.65f*y,-p-r+.65f*y}};float s=1;
 for(float v:c){if(v>0)s=std::min(s,(1-t)/v);else if(v<0)s=std::min(s,t/-v);}s=clamp(s,0.0f,1.0f);Mix o;for(size_t i=0;i<4;i++)o.m[i]=clamp(t+s*c[i],0.0f,1.0f);return o;
}
constexpr uint16_t pulse(float v,bool armed,uint16_t idle=1050,uint16_t max=2000){return armed?uint16_t(idle+clamp(v,0.0f,1.0f)*(max-idle)+.5f):1000;}

class Arm{
 bool armed_{},low_{};uint64_t since_{};
public:
 struct R{bool armed{},on{},off{};};
 R run(uint64_t us,bool rc,Cmd c,bool imu,float roll,float pitch){
  R z{armed_,false,false};
  if(!rc){z.off=armed_;armed_=low_=false;since_=0;z.armed=false;return z;}
  if(!c.arm){low_=true;since_=0;z.off=armed_;armed_=false;z.armed=false;return z;}
  if(armed_)return z;
  bool ok=low_&&c.t<=.035f&&std::fabs(c.r)<.12f&&std::fabs(c.p)<.12f&&std::fabs(c.y)<.15f&&std::fabs(roll)<20&&std::fabs(pitch)<20&&imu;
  if(!ok){since_=0;return z;}if(!since_)since_=us;if(us-since_>=1000000){armed_=z.armed=z.on=true;}return z;
 }
};
class Control{
 PID rp_{Gains{.0018f,.0009f,.0000035f,.18f,.38f,55}},pp_{Gains{.0018f,.0009f,.0000035f,.18f,.38f,55}},yp_{Gains{.0015f,.0007f,0,.14f,.28f,40}};
public:
 Att att;
 void reset(){rp_.reset();pp_.reset();yp_.reset();}
 Mix run(Imu s,Cmd c,float dt,bool integ){float rr=clamp((c.r*32-att.r)*5.2f,-240.0f,240.0f),pr=clamp((c.p*32-att.p)*5.2f,-240.0f,240.0f),yr=c.y*180;return mix(c.t,rp_.run(rr,s.g.x,dt,integ),pp_.run(pr,s.g.y,dt,integ),yp_.run(yr,s.g.z,dt,integ));}
};
}

#ifdef FC_HOST_TEST
#include <cstdio>
#include <cstdlib>
#define CK(x) do{if(!(x)){std::fprintf(stderr,"FAIL:%d %s\n",__LINE__,#x);std::exit(1);}}while(0)
static void encode(const std::array<uint16_t,16>&c,uint8_t*p){std::memset(p,0,25);p[0]=0x0f;for(int n=0;n<16;n++)for(int b=0;b<11;b++)if(c[n]&(1u<<b)){int k=8+n*11+b;p[k/8]|=1u<<(k%8);}}
int main(){
 std::array<uint16_t,16>c{};for(size_t i=0;i<16;i++)c[i]=172+i*97;uint8_t p[25]{};encode(c,p);fc::RC r;CK(fc::decode(p,r));for(size_t i=0;i<16;i++)CK(r.ch[i]==c[i]);
 fc::Sbus sb;fc::RC q;bool done=false;for(size_t i=0;i<25;i++)done=sb.feed(p[i],100+i*100,q);CK(done&&q.ch[7]==c[7]);p[24]=0xff;CK(!fc::decode(p,r));
 fc::PT1 f(100);float x=0;for(int i=0;i<1000;i++)x=f.run(1,.001f);CK(x>.999f&&x<=1);
 fc::PID pid({.01f,.1f,.0001f,.2f,.5f,50});for(int i=0;i<10000;i++){float u=pid.run(100,0,.001f,true);CK(std::isfinite(u)&&std::fabs(u)<=.5f);}CK(pid.integral()<=.2001f);
 auto m=fc::mix(.9f,.4f,-.3f,.3f);for(float v:m.m)CK(v>=0&&v<=1);CK(fc::pulse(0,false)==1000&&fc::pulse(0,true)==1050&&fc::pulse(1,true)==2000);
 fc::Arm a;fc::Cmd z{};a.run(0,true,z,true,0,0);z.arm=true;CK(!a.run(1,true,z,true,0,0).armed);CK(a.run(1000002,true,z,true,0,0).on);CK(a.run(1001000,false,z,true,0,0).off);
 fc::Control ctl;ctl.att.reset({0,0,1});fc::Imu im{{0,0,1},{0,0,0}};fc::Cmd cmd{};cmd.t=.35f;for(int i=0;i<2000;i++){ctl.att.run(im,.001f);auto o=ctl.run(im,cmd,.001f,true);for(float v:o.m)CK(std::isfinite(v)&&v>=0&&v<=1);}
 std::puts("All Arondight45 DroneFC tests passed.");
}
#else
extern "C"{
#include "sdkconfig.h"
#include "driver/gpio.h"
#include "driver/mcpwm_prelude.h"
#include "driver/spi_master.h"
#include "driver/uart.h"
#include "esp_attr.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
}
#ifndef CONFIG_IDF_TARGET_ESP32S31
#error Build with idf.py set-target esp32s31
#endif
#ifndef FC_PIN_IMU_MOSI
#define FC_PIN_IMU_MOSI 11
#endif
#ifndef FC_PIN_IMU_MISO
#define FC_PIN_IMU_MISO 12
#endif
#ifndef FC_PIN_IMU_SCLK
#define FC_PIN_IMU_SCLK 13
#endif
#ifndef FC_PIN_IMU_CS
#define FC_PIN_IMU_CS 10
#endif
#ifndef FC_PIN_IMU_DRDY
#define FC_PIN_IMU_DRDY 9
#endif
#ifndef FC_PIN_SBUS
#define FC_PIN_SBUS 8
#endif
#ifndef FC_PIN_M1
#define FC_PIN_M1 4
#endif
#ifndef FC_PIN_M2
#define FC_PIN_M2 5
#endif
#ifndef FC_PIN_M3
#define FC_PIN_M3 6
#endif
#ifndef FC_PIN_M4
#define FC_PIN_M4 7
#endif
#ifndef FC_PIN_KILL
#define FC_PIN_KILL -1
#endif
#ifndef FC_IMU_ROTATION
#define FC_IMU_ROTATION 0
#endif
#ifndef FC_IMU_FLIPPED
#define FC_IMU_FLIPPED 0
#endif
#ifndef FC_ESC_MIN
#define FC_ESC_MIN 1000
#endif
#ifndef FC_ESC_IDLE
#define FC_ESC_IDLE 1050
#endif
#ifndef FC_ESC_MAX
#define FC_ESC_MAX 2000
#endif
static_assert(FC_IMU_ROTATION==0||FC_IMU_ROTATION==90||FC_IMU_ROTATION==180||FC_IMU_ROTATION==270);
static_assert(FC_ESC_MIN<FC_ESC_IDLE&&FC_ESC_IDLE<FC_ESC_MAX);

namespace hw{
constexpr char TAG[]="Arondight45-FC";constexpr auto HOST=SPI2_HOST;constexpr auto UART=UART_NUM_1;
TaskHandle_t flight_h{};portMUX_TYPE rc_mux=portMUX_INITIALIZER_UNLOCKED;fc::RC rc{};spi_device_handle_t imu{};
mcpwm_timer_handle_t mt{};std::array<mcpwm_cmpr_handle_t,4>cmp{};std::array<mcpwm_gen_handle_t,4>gen{};
std::atomic<bool>armed{false},killed{false};std::atomic<uint32_t>beat{0};
#define TRY(x,msg) do{esp_err_t e=(x);if(e!=ESP_OK){ESP_LOGE(TAG,"%s: %s",msg,esp_err_to_name(e));return e;}}while(0)
uint64_t now64(){return uint64_t(esp_timer_get_time());}uint32_t now32(){return uint32_t(esp_timer_get_time());}
void hardkill(){if(killed.exchange(true))return;armed=false;for(auto g:gen)if(g)(void)mcpwm_generator_set_force_level(g,0,true);}
[[noreturn]]void fatal(const char*s){hardkill();ESP_EARLY_LOGE(TAG,"FATAL %s",s);esp_restart();for(;;){}}
bool motors(std::array<uint16_t,4>u){if(killed.load())return false;for(size_t i=0;i<4;i++)if(mcpwm_comparator_set_compare_value(cmp[i],fc::clamp<uint32_t>(u[i],FC_ESC_MIN,FC_ESC_MAX))!=ESP_OK)return false;return true;}
bool disarm(){return motors({FC_ESC_MIN,FC_ESC_MIN,FC_ESC_MIN,FC_ESC_MIN});}
esp_err_t motor_init(){
 int pin[4]={FC_PIN_M1,FC_PIN_M2,FC_PIN_M3,FC_PIN_M4};mcpwm_timer_config_t tc{};tc.group_id=0;tc.clk_src=MCPWM_TIMER_CLK_SRC_DEFAULT;tc.resolution_hz=1000000;tc.period_ticks=2500;tc.count_mode=MCPWM_TIMER_COUNT_MODE_UP;TRY(mcpwm_new_timer(&tc,&mt),"timer");
 for(int op=0;op<2;op++){mcpwm_oper_handle_t o{};mcpwm_operator_config_t oc{};oc.group_id=0;TRY(mcpwm_new_operator(&oc,&o),"operator");TRY(mcpwm_operator_connect_timer(o,mt),"connect");for(int j=0;j<2;j++){int i=op*2+j;mcpwm_comparator_config_t cc{};cc.flags.update_cmp_on_tez=true;TRY(mcpwm_new_comparator(o,&cc,&cmp[i]),"comparator");mcpwm_generator_config_t gc{};gc.gen_gpio_num=pin[i];TRY(mcpwm_new_generator(o,&gc,&gen[i]),"generator");TRY(mcpwm_comparator_set_compare_value(cmp[i],FC_ESC_MIN),"compare");TRY(mcpwm_generator_set_action_on_timer_event(gen[i],MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP,MCPWM_TIMER_EVENT_EMPTY,MCPWM_GEN_ACTION_HIGH)),"timer action");TRY(mcpwm_generator_set_action_on_compare_event(gen[i],MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP,cmp[i],MCPWM_GEN_ACTION_LOW)),"compare action");}}
 TRY(mcpwm_timer_enable(mt),"enable");TRY(mcpwm_timer_start_stop(mt,MCPWM_TIMER_START_NO_STOP),"start");return disarm()?ESP_OK:ESP_FAIL;
}
namespace reg{constexpr uint8_t DEV_CFG=0x11,INT_CFG=0x14,TEMP=0x1d,IF_CFG=0x4c,PWR=0x4e,GYRO=0x4f,ACC=0x50,INT_CLR=0x63,INT_SRC=0x65,WHO=0x75;}
esp_err_t wr(uint8_t r,uint8_t v){uint8_t b[2]={uint8_t(r&0x7f),v};spi_transaction_t t{};t.length=16;t.tx_buffer=b;return spi_device_polling_transmit(imu,&t);}
esp_err_t rd(uint8_t r,uint8_t*out,size_t n){if(!out||!n||n>31)return ESP_ERR_INVALID_ARG;uint8_t tx[32]{},rx[32]{};tx[0]=r|0x80;spi_transaction_t t{};t.length=(n+1)*8;t.tx_buffer=tx;t.rx_buffer=rx;TRY(spi_device_polling_transmit(imu,&t),"spi read");std::memcpy(out,rx+1,n);return ESP_OK;}
esp_err_t wv(uint8_t r,uint8_t v){TRY(wr(r,v),"imu write");uint8_t q{};TRY(rd(r,&q,1),"imu verify");return q==v?ESP_OK:ESP_ERR_INVALID_RESPONSE;}
void IRAM_ATTR drdy(void*){BaseType_t w=pdFALSE;if(flight_h)vTaskNotifyGiveFromISR(flight_h,&w);if(w)portYIELD_FROM_ISR();}
esp_err_t imu_init(){
 spi_bus_config_t bc{};bc.mosi_io_num=FC_PIN_IMU_MOSI;bc.miso_io_num=FC_PIN_IMU_MISO;bc.sclk_io_num=FC_PIN_IMU_SCLK;bc.quadwp_io_num=bc.quadhd_io_num=-1;bc.max_transfer_sz=32;TRY(spi_bus_initialize(HOST,&bc,SPI_DMA_CH_AUTO),"spi bus");spi_device_interface_config_t dc{};dc.clock_speed_hz=10000000;dc.mode=0;dc.spics_io_num=FC_PIN_IMU_CS;dc.queue_size=1;TRY(spi_bus_add_device(HOST,&dc,&imu),"spi dev");TRY(wr(reg::DEV_CFG,1),"reset");vTaskDelay(pdMS_TO_TICKS(10));uint8_t q{};TRY(rd(reg::WHO,&q,1),"who");if(q!=0x47)return ESP_ERR_INVALID_RESPONSE;TRY(rd(reg::IF_CFG,&q,1),"if");TRY(wv(reg::IF_CFG,(q&0xf0)|3),"disable i2c");TRY(wv(reg::GYRO,6),"gyro");TRY(wv(reg::ACC,6),"acc");TRY(wv(reg::PWR,0x0f),"power");vTaskDelay(pdMS_TO_TICKS(50));TRY(wv(reg::INT_CFG,3),"int pin");TRY(wv(reg::INT_CLR,0x20),"int clear");TRY(wv(reg::INT_SRC,8),"int src");gpio_config_t io{};io.pin_bit_mask=1ULL<<FC_PIN_IMU_DRDY;io.mode=GPIO_MODE_INPUT;io.pull_down_en=GPIO_PULLDOWN_ENABLE;io.intr_type=GPIO_INTR_POSEDGE;TRY(gpio_config(&io),"drdy gpio");esp_err_t e=gpio_install_isr_service(ESP_INTR_FLAG_IRAM);if(e!=ESP_OK&&e!=ESP_ERR_INVALID_STATE)return e;return gpio_isr_handler_add((gpio_num_t)FC_PIN_IMU_DRDY,drdy,nullptr);
}
int16_t be(const uint8_t*p){return int16_t(uint16_t(p[0])<<8|p[1]);}
fc::V3 orient(fc::V3 v){fc::V3 o{};
#if FC_IMU_ROTATION==0
 o=v;
#elif FC_IMU_ROTATION==90
 o={-v.y,v.x,v.z};
#elif FC_IMU_ROTATION==180
 o={-v.x,-v.y,v.z};
#else
 o={v.y,-v.x,v.z};
#endif
#if FC_IMU_FLIPPED
 o.y=-o.y;o.z=-o.z;
#endif
 return o;}
esp_err_t sample(fc::Imu&s){uint8_t b[14]{};TRY(rd(reg::TEMP,b,14),"sample");int16_t ax=be(b+2),ay=be(b+4),az=be(b+6),gx=be(b+8),gy=be(b+10),gz=be(b+12),bad=std::numeric_limits<int16_t>::min();if(ax==bad||ay==bad||az==bad||gx==bad||gy==bad||gz==bad)return ESP_ERR_INVALID_RESPONSE;s.a=orient({ax/2048.0f,ay/2048.0f,az/2048.0f});s.g=orient({gx/16.4f,gy/16.4f,gz/16.4f});return fc::finite(s.a)&&fc::finite(s.g)?ESP_OK:ESP_ERR_INVALID_RESPONSE;}
esp_err_t sbus_init(){uart_config_t u{};u.baud_rate=100000;u.data_bits=UART_DATA_8_BITS;u.parity=UART_PARITY_EVEN;u.stop_bits=UART_STOP_BITS_2;u.flow_ctrl=UART_HW_FLOWCTRL_DISABLE;u.source_clk=UART_SCLK_DEFAULT;TRY(uart_driver_install(UART,1024,0,0,nullptr,0),"uart driver");TRY(uart_param_config(UART,&u),"uart config");TRY(uart_set_pin(UART,UART_PIN_NO_CHANGE,FC_PIN_SBUS,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE),"uart pin");TRY(uart_set_line_inverse(UART,UART_SIGNAL_RXD_INV),"uart invert");return uart_flush_input(UART);}
void rc_task(void*){fc::Sbus p;uint8_t b[64];for(;;){int n=uart_read_bytes(UART,b,sizeof b,pdMS_TO_TICKS(20));for(int i=0;i<n;i++){fc::RC x;if(p.feed(b[i],now64(),x)){portENTER_CRITICAL(&rc_mux);rc=x;portEXIT_CRITICAL(&rc_mux);}}}}
fc::RC getrc(){fc::RC x;portENTER_CRITICAL(&rc_mux);x=rc;portEXIT_CRITICAL(&rc_mux);return x;}
struct Cal{fc::V3 gb,am;};
bool calibrate(Cal&o){constexpr int N=2000;fc::V3 s{},ss{},a{};for(int i=0;i<N;i++){if(!ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(5)))return false;fc::Imu x;if(sample(x)!=ESP_OK)return false;s.x+=x.g.x;s.y+=x.g.y;s.z+=x.g.z;ss.x+=x.g.x*x.g.x;ss.y+=x.g.y*x.g.y;ss.z+=x.g.z*x.g.z;a.x+=x.a.x;a.y+=x.a.y;a.z+=x.a.z;(void)esp_task_wdt_reset();}float k=1.0f/N;o.gb={s.x*k,s.y*k,s.z*k};o.am={a.x*k,a.y*k,a.z*k};fc::V3 sd{std::sqrt(std::max(0.0f,ss.x*k-o.gb.x*o.gb.x)),std::sqrt(std::max(0.0f,ss.y*k-o.gb.y*o.gb.y)),std::sqrt(std::max(0.0f,ss.z*k-o.gb.z*o.gb.z))};return std::fabs(o.gb.x)<15&&std::fabs(o.gb.y)<15&&std::fabs(o.gb.z)<15&&sd.x<.8f&&sd.y<.8f&&sd.z<.8f&&fc::mag(o.am)>.85f&&fc::mag(o.am)<1.15f;}
void flight(void*){
 if(esp_task_wdt_add(nullptr)!=ESP_OK)fatal("wdt add");if(imu_init()!=ESP_OK)fatal("imu init");Cal c;if(!calibrate(c))fatal("calibration");fc::Filters fil;fc::Control ctl;ctl.att.reset(c.am);fc::Arm arm;uint64_t last=0;int badtime=0;
 for(;;){uint32_t notes=ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(5));if(!notes)fatal("imu timeout");uint64_t now=now64();fc::Imu raw;if(sample(raw)!=ESP_OK)fatal("imu data");raw.g.x-=c.gb.x;raw.g.y-=c.gb.y;raw.g.z-=c.gb.z;uint32_t us=last?uint32_t(now-last):1000;last=now;if(us<600||us>1600||notes>2)badtime++;else badtime=0;if(armed.load()&&badtime>=5)fatal("deadline");float dt=armed.load()?us*1e-6f:.001f;fc::Imu im=fil.run(raw,dt);if(std::fabs(im.g.x)>1750||std::fabs(im.g.y)>1750||std::fabs(im.g.z)>1750)fatal("rate");fc::RC rr=getrc();bool fresh=rr.valid&&now>=rr.us&&now-rr.us<=100000;fc::Cmd cmd=fc::command(rr);
#if FC_PIN_KILL>=0
  if(!gpio_get_level((gpio_num_t)FC_PIN_KILL))fatal("kill");
#endif
  ctl.att.run(im,dt);auto ar=arm.run(now,fresh,cmd,fc::mag(im.a)>.7f&&fc::mag(im.a)<1.3f,ctl.att.r,ctl.att.p);if(!ar.armed){armed=false;ctl.reset();if(!disarm())fatal("motor");}if(ar.on){ctl.reset();armed=true;}if(ar.armed){if(std::fabs(ctl.att.r)>68||std::fabs(ctl.att.p)>68)fatal("tilt");fc::Mix m{};if(cmd.t<=.02f)ctl.reset();else m=ctl.run(im,cmd,dt,cmd.t>.05f);std::array<uint16_t,4>u{};for(size_t i=0;i<4;i++)u[i]=fc::pulse(m.m[i],true,FC_ESC_IDLE,FC_ESC_MAX);if(!motors(u))fatal("motor");}beat.store(now32(),std::memory_order_release);if(esp_task_wdt_reset()!=ESP_OK)fatal("wdt");
 }}
void safety(void*){if(esp_task_wdt_add(nullptr)!=ESP_OK)fatal("safety wdt");for(;;){if(armed.load()){uint32_t b=beat.load(std::memory_order_acquire);if(b&&uint32_t(now32()-b)>30000)fatal("heartbeat");
#if FC_PIN_KILL>=0
 if(!gpio_get_level((gpio_num_t)FC_PIN_KILL))fatal("kill");
#endif
 }(void)esp_task_wdt_reset();vTaskDelay(pdMS_TO_TICKS(5));}}
esp_err_t setup_kill(){
#if FC_PIN_KILL>=0
 gpio_config_t c{};c.pin_bit_mask=1ULL<<FC_PIN_KILL;c.mode=GPIO_MODE_INPUT;c.pull_up_en=GPIO_PULLUP_ENABLE;return gpio_config(&c);
#else
 return ESP_OK;
#endif
}
esp_err_t setup_wdt(){esp_task_wdt_config_t c{};c.timeout_ms=500;c.trigger_panic=true;esp_err_t e=esp_task_wdt_reconfigure(&c);return e==ESP_ERR_INVALID_STATE?esp_task_wdt_init(&c):e;}
}
extern "C" void app_main(){ESP_ERROR_CHECK(hw::setup_wdt());ESP_ERROR_CHECK(hw::setup_kill());ESP_ERROR_CHECK(hw::motor_init());ESP_ERROR_CHECK(hw::sbus_init());
#if CONFIG_FREERTOS_NUMBER_OF_CORES>1
 constexpr BaseType_t F=1,S=0;
#else
 constexpr BaseType_t F=tskNO_AFFINITY,S=tskNO_AFFINITY;
#endif
 BaseType_t e=xTaskCreatePinnedToCore(hw::flight,"flight",8192,nullptr,configMAX_PRIORITIES-2,&hw::flight_h,F);ESP_ERROR_CHECK(e==pdPASS?ESP_OK:ESP_ERR_NO_MEM);e=xTaskCreatePinnedToCore(hw::safety,"safety",4096,nullptr,configMAX_PRIORITIES-3,nullptr,S);ESP_ERROR_CHECK(e==pdPASS?ESP_OK:ESP_ERR_NO_MEM);e=xTaskCreatePinnedToCore(hw::rc_task,"sbus",4096,nullptr,12,nullptr,S);ESP_ERROR_CHECK(e==pdPASS?ESP_OK:ESP_ERR_NO_MEM);}
#endif
