/*
 * Arondight45 DroneFC — ESP32-S31 / ESP-IDF master
 * Reference stack: ICM-42688-P SPI+DRDY 1 kHz, inverted SBUS 100k 8E2,
 * Quad-X, four 400 Hz PWM ESCs. Boots disarmed.
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
struct V3{float x{},y{},z{};}; inline float mag(V3 v){return std::sqrt(v.x*v.x+v.y*v.y+v.z*v.z);} inline bool finite(V3 v){return std::isfinite(v.x)&&std::isfinite(v.y)&&std::isfinite(v.z);} struct Imu{V3 a{},g{};};
class PT1{float fc_,y_{};bool init_{};public:explicit PT1(float f):fc_(f){} float run(float x,float dt){if(!init_||!(dt>0)||!std::isfinite(dt)){y_=x;init_=true;return y_;}float rc=1/(2*pi*fc_),k=clamp(dt/(rc+dt),0.0f,1.0f);y_+=k*(x-y_);return y_;}void reset(){y_=0;init_=false;}};
struct Filters{std::array<PT1,3>g{PT1(100),PT1(100),PT1(100)},a{PT1(30),PT1(30),PT1(30)};Imu run(Imu s,float dt){return{{a[0].run(s.a.x,dt),a[1].run(s.a.y,dt),a[2].run(s.a.z,dt)},{g[0].run(s.g.x,dt),g[1].run(s.g.y,dt),g[2].run(s.g.z,dt)}};}};
struct Att{float r{},p{},y{};void reset(V3 a){r=std::atan2(a.y,a.z)*180/pi;p=std::atan2(-a.x,std::sqrt(a.y*a.y+a.z*a.z))*180/pi;y=0;}void run(Imu s,float dt){r+=s.g.x*dt;p+=s.g.y*dt;y+=s.g.z*dt;if(y>180)y-=360;if(y<-180)y+=360;float n=mag(s.a);if(n>.8f&&n<1.2f){float ar=std::atan2(s.a.y,s.a.z)*180/pi,ap=std::atan2(-s.a.x,std::sqrt(s.a.y*s.a.y+s.a.z*s.a.z))*180/pi;float tau=1/(2*pi*1.4f),k=clamp(dt/(tau+dt),0.0f,.02f);r+=k*(ar-r);p+=k*(ap-p);}}};
struct Gains{float kp,ki,kd,ilim,olim,df;}; class PID{Gains q_;PT1 df_;float i_{},prev_{};bool have_{};public:explicit PID(Gains q):q_(q),df_(q.df){}float run(float sp,float m,float dt,bool integ){if(!(dt>0)||!std::isfinite(sp)||!std::isfinite(m))return 0;float e=sp-m,d=have_?-(m-prev_)/dt:0;prev_=m;have_=true;d=df_.run(d,dt);float u=q_.kp*e+i_+q_.kd*d;if(integ&&!((u>=q_.olim&&e>0)||(u<=-q_.olim&&e<0)))i_=clamp(i_+q_.ki*e*dt,-q_.ilim,q_.ilim);return clamp(q_.kp*e+i_+q_.kd*d,-q_.olim,q_.olim);}void reset(){i_=prev_=0;have_=false;df_.reset();}float integral()const{return i_;}};
struct RC{std::array<uint16_t,16>ch{};bool lost{},fs{},valid{};uint64_t us{};};inline bool sbus_end(uint8_t b){return b==0||b==4||b==0x14||b==0x24||b==0x34;}inline bool decode(const uint8_t*p,RC&o){if(!p||p[0]!=0x0f||!sbus_end(p[24]))return false;o.ch[0]=(p[1]|p[2]<<8)&0x7ff;o.ch[1]=(p[2]>>3|p[3]<<5)&0x7ff;o.ch[2]=(p[3]>>6|p[4]<<2|p[5]<<10)&0x7ff;o.ch[3]=(p[5]>>1|p[6]<<7)&0x7ff;o.ch[4]=(p[6]>>4|p[7]<<4)&0x7ff;o.ch[5]=(p[7]>>7|p[8]<<1|p[9]<<9)&0x7ff;o.ch[6]=(p[9]>>2|p[10]<<6)&0x7ff;o.ch[7]=(p[10]>>5|p[11]<<3)&0x7ff;o.ch[8]=(p[12]|p[13]<<8)&0x7ff;o.ch[9]=(p[13]>>3|p[14]<<5)&0x7ff;o.ch[10]=(p[14]>>6|p[15]<<2|p[16]<<10)&0x7ff;o.ch[11]=(p[16]>>1|p[17]<<7)&0x7ff;o.ch[12]=(p[17]>>4|p[18]<<4)&0x7ff;o.ch[13]=(p[18]>>7|p[19]<<1|p[20]<<9)&0x7ff;o.ch[14]=(p[20]>>2|p[21]<<6)&0x7ff;o.ch[15]=(p[21]>>5|p[22]<<3)&0x7ff;o.lost=p[23]&4;o.fs=p[23]&8;o.valid=!o.lost&&!o.fs;return true;}
class Sbus{std::array<uint8_t,25>b_{};size_t n_{};uint64_t last_{};public:bool feed(uint8_t b,uint64_t us,RC&o){if(n_&&us>last_&&us-last_>3000)n_=0;last_=us;if(!n_){if(b!=0x0f)return false;b_[n_++]=b;return false;}b_[n_++]=b;if(n_<25)return false;n_=0;if(decode(b_.data(),o)){o.us=us;return true;}for(size_t i=1;i<25;i++)if(b_[i]==0x0f){size_t k=25-i;std::memmove(b_.data(),b_.data()+i,k);n_=k;break;}return false;}};
inline float centered(uint16_t v){return clamp((float(v)-992)/820,-1.0f,1.0f);}inline float throttle(uint16_t v){return clamp((float(v)-172)/(1811-172),0.0f,1.0f);}inline float shape(float x,float db,float expo){float a=std::fabs(x);if(a<=db)return 0;float t=(a-db)/(1-db),v=t*(1-expo)+t*t*t*expo;return std::copysign(clamp(v,0.0f,1.0f),x);}struct Cmd{float r{},p{},t{},y{};bool arm{};};inline Cmd command(const RC&r){return{shape(centered(r.ch[FC_SBUS_ROLL]),.035f,.3f),-shape(centered(r.ch[FC_SBUS_PITCH]),.035f,.3f),throttle(r.ch[FC_SBUS_THROTTLE]),shape(centered(r.ch[FC_SBUS_YAW]),.045f,.2f),r.ch[FC_SBUS_ARM]>1300};}
struct Mix{std::array<float,4>m{};};inline Mix mix(float t,float r,float p,float y){t=clamp(t,0.0f,1.0f);std::array<float,4>c{{p-r-.65f*y,p+r+.65f*y,-p+r-.65f*y,-p-r+.65f*y}};float s=1;for(float v:c){if(v>0)s=std::min(s,(1-t)/v);else if(v<0)s=std::min(s,t/-v);}s=clamp(s,0.0f,1.0f);Mix o;for(size_t i=0;i<4;i++)o.m[i]=clamp(t+s*c[i],0.0f,1.0f);return o;}constexpr uint16_t pulse(float v,bool armed,uint16_t idle=1050,uint16_t max=2000){return armed?uint16_t(idle+clamp(v,0.0f,1.0f)*(max-idle)+.5f):1000;}
class Arm{bool armed_{},low_{};uint64_t since_{};public:struct R{bool armed{},on{},off{};};R run(uint64_t us,bool rc,Cmd c,bool imu,float roll,float pitch){R z{armed_,false,false};if(!rc){z.off=armed_;armed_=low_=false;since_=0;z.armed=false;return z;}if(!c.arm){low_=true;since_=0;z.off=armed_;armed_=false;z.armed=false;return z;}if(armed_)return z;bool ok=low_&&c.t<=.035f&&std::fabs(c.r)<.12f&&std::fabs(c.p)<.12f&&std::fabs(c.y)<.15f&&std::fabs(roll)<20&&std::fabs(pitch)<20&&imu;if(!ok){since_=0;return z;}if(!since_)since_=us;if(us-since_>=1000000)armed_=z.armed=z.on=true;return z;}};
class Control{PID rp_{Gains{.0018f,.0009f,.0000035f,.18f,.38f,55}},pp_{Gains{.0018f,.0009f,.0000035f,.18f,.38f,55}},yp_{Gains{.0015f,.0007f,0,.14f,.28f,40}};public:Att att;void reset(){rp_.reset();pp_.reset();yp_.reset();}Mix run(Imu s,Cmd c,float dt,bool integ){float rr=clamp((c.r*32-att.r)*5.2f,-240.0f,240.0f),pr=clamp((c.p*32-att.p)*5.2f,-240.0f,240.0f),yr=c.y*180;return mix(c.t,rp_.run(rr,s.g.x,dt,integ),pp_.run(pr,s.g.y,dt,integ),yp_.run(yr,s.g.z,dt,integ));}};
}
#ifdef FC_HOST_TEST
#include <cstdio>
#include <cstdlib>
#define CK(x) do{if(!(x)){std::fprintf(stderr,"FAIL:%d %s\n",__LINE__,#x);std::exit(1);}}while(0)
static void encode(const std::array<uint16_t,16>&c,uint8_t*p){std::memset(p,0,25);p[0]=0x0f;for(int n=0;n<16;n++)for(int b=0;b<11;b++)if(c[n]&(1u<<b)){int k=8+n*11+b;p[k/8]|=1u<<(k%8);}}
int main(){std::array<uint16_t,16>c{};for(size_t i=0;i<16;i++)c[i]=172+i*97;uint8_t p[25]{};encode(c,p);fc::RC r;CK(fc::decode(p,r));for(size_t i=0;i<16;i++)CK(r.ch[i]==c[i]);fc::Sbus sb;fc::RC q;bool done=false;for(size_t i=0;i<25;i++)done=sb.feed(p[i],100+i*100,q);CK(done&&q.ch[7]==c[7]);p[24]=0xff;CK(!fc::decode(p,r));fc::PT1 f(100);float x=0;for(int i=0;i<1000;i++)x=f.run(1,.001f);CK(x>.999f&&x<=1);fc::PID pid({.01f,.1f,.0001f,.2f,.5f,50});for(int i=0;i<10000;i++){float u=pid.run(100,0,.001f,true);CK(std::isfinite(u)&&std::fabs(u)<=.5f);}CK(pid.integral()<=.2001f);auto m=fc::mix(.9f,.4f,-.3f,.3f);for(float v:m.m)CK(v>=0&&v<=1);CK(fc::pulse(0,false)==1000&&fc::pulse(0,true)==1050&&fc::pulse(1,true)==2000);fc::Arm a;fc::Cmd z{};a.run(0,true,z,true,0,0);z.arm=true;CK(!a.run(1,true,z,true,0,0).armed);CK(a.run(1000002,true,z,true,0,0).on);CK(a.run(1001000,false,z,true,0,0).off);fc::Control ctl;ctl.att.reset({0,0,1});fc::Imu im{{0,0,1},{0,0,0}};fc::Cmd cmd{};cmd.t=.35f;for(int i=0;i<2000;i++){ctl.att.run(im,.001f);auto o=ctl.run(im,cmd,.001f,true);for(float v:o.m)CK(std::isfinite(v)&&v>=0&&v<=1);}std::puts("All Arondight45 DroneFC tests passed.");return 0;}
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
#define FC_PIN_IMU_MISO 12
#define FC_PIN_IMU_SCLK 13
#define FC_PIN_IMU_CS 10
#define FC_PIN_IMU_DRDY 9
#define FC_PIN_SBUS 8
#endif
#ifndef FC_PIN_M1
#define FC_PIN_M1 4
#define FC_PIN_M2 5
#define FC_PIN_M3 6
#define FC_PIN_M4 7
#endif
namespace {constexpr char TAG[]="DroneFC";constexpr float DEG=180.0f/fc::pi;spi_device_handle_t spi{};TaskHandle_t task{};std::atomic<bool> tick{false};fc::Filters filters;fc::Control ctl;fc::Arm arm;fc::Sbus sbus;fc::RC rc;bool calibrated=false;fc::V3 gb{},gs{},as{};uint32_t caln=0;uint64_t last_rc=0,last_loop=0;std::array<mcpwm_cmpr_handle_t,4>cmp{};
void IRAM_ATTR drdy(void*){tick.store(true,std::memory_order_release);BaseType_t hp=pdFALSE;vTaskNotifyGiveFromISR(task,&hp);if(hp)portYIELD_FROM_ISR();}
bool reg_read(uint8_t r,uint8_t*p,size_t n){uint8_t tx[32]{},rx[32]{};if(n+1>sizeof(tx))return false;tx[0]=r|0x80;spi_transaction_t t{};t.length=(n+1)*8;t.tx_buffer=tx;t.rx_buffer=rx;if(spi_device_transmit(spi,&t)!=ESP_OK)return false;std::memcpy(p,rx+1,n);return true;}bool reg_write(uint8_t r,uint8_t v){uint8_t b[2]{r,v};spi_transaction_t t{};t.length=16;t.tx_buffer=b;return spi_device_transmit(spi,&t)==ESP_OK;}
int16_t be16(const uint8_t*p){return int16_t((uint16_t(p[0])<<8)|p[1]);}bool imu_read(fc::Imu&o){uint8_t b[14];if(!reg_read(0x1D,b,14))return false;o.a={be16(b+2)/2048.0f,be16(b+4)/2048.0f,be16(b+6)/2048.0f};o.g={be16(b+8)/16.4f,be16(b+10)/16.4f,be16(b+12)/16.4f};return fc::finite(o.a)&&fc::finite(o.g);}
void setmot(fc::Mix m,bool armed){for(size_t i=0;i<4;i++)mcpwm_comparator_set_compare_value(cmp[i],fc::pulse(m.m[i],armed));}
void loop(void*){task=xTaskGetCurrentTaskHandle();fc::Imu raw{};for(;;){ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(10));uint64_t now=esp_timer_get_time();float dt=last_loop?float(now-last_loop)*1e-6f:.001f;last_loop=now;if(!imu_read(raw)||dt<.0005f||dt>.003f){setmot({},false);continue;}if(!calibrated){gs.x+=raw.g.x;gs.y+=raw.g.y;gs.z+=raw.g.z;as.x+=raw.a.x;as.y+=raw.a.y;as.z+=raw.a.z;if(++caln>=2000){float k=1.0f/caln;gb={gs.x*k,gs.y*k,gs.z*k};fc::V3 am{as.x*k,as.y*k,as.z*k};if(std::fabs(gb.x)<15&&std::fabs(gb.y)<15&&std::fabs(gb.z)<15&&fc::mag(am)>.85f&&fc::mag(am)<1.15f){ctl.att.reset(am);calibrated=true;}}setmot({},false);continue;}raw.g.x-=gb.x;raw.g.y-=gb.y;raw.g.z-=gb.z;fc::Imu im=filters.run(raw,dt);bool rv=rc.valid&&now-last_rc<100000;fc::Cmd c=fc::command(rc);ctl.att.run(im,dt);auto ar=arm.run(now,rv,c,fc::mag(im.a)>.7f&&fc::mag(im.a)<1.3f,ctl.att.r,ctl.att.p);if(!ar.armed){ctl.reset();setmot({},false);continue;}fc::Mix m{};if(c.t>.02f)m=ctl.run(im,c,dt,c.t>.05f);setmot(m,true);}}
void rc_task(void*){uint8_t b;for(;;)if(uart_read_bytes(UART_NUM_1,&b,1,pdMS_TO_TICKS(20))==1&&sbus.feed(b,esp_timer_get_time(),rc))last_rc=rc.us;}}
}
extern "C" void app_main(){spi_bus_config_t bus{};bus.mosi_io_num=FC_PIN_IMU_MOSI;bus.miso_io_num=FC_PIN_IMU_MISO;bus.sclk_io_num=FC_PIN_IMU_SCLK;bus.max_transfer_sz=32;ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST,&bus,SPI_DMA_DISABLED));spi_device_interface_config_t dev{};dev.clock_speed_hz=10000000;dev.mode=0;dev.spics_io_num=FC_PIN_IMU_CS;dev.queue_size=1;ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST,&dev,&spi));reg_write(0x11,1);vTaskDelay(pdMS_TO_TICKS(100));reg_write(0x4E,0x0F);reg_write(0x4F,0x06);reg_write(0x50,0x06);uart_config_t uc{};uc.baud_rate=100000;uc.data_bits=UART_DATA_8_BITS;uc.parity=UART_PARITY_EVEN;uc.stop_bits=UART_STOP_BITS_2;ESP_ERROR_CHECK(uart_driver_install(UART_NUM_1,512,0,0,nullptr,0));ESP_ERROR_CHECK(uart_param_config(UART_NUM_1,&uc));ESP_ERROR_CHECK(uart_set_pin(UART_NUM_1,UART_PIN_NO_CHANGE,FC_PIN_SBUS,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE));mcpwm_timer_handle_t tim;mcpwm_timer_config_t tc{};tc.group_id=0;tc.clk_src=MCPWM_TIMER_CLK_SRC_DEFAULT;tc.resolution_hz=1000000;tc.period_ticks=2500;tc.count_mode=MCPWM_TIMER_COUNT_MODE_UP;ESP_ERROR_CHECK(mcpwm_new_timer(&tc,&tim));for(int i=0;i<4;i++){mcpwm_oper_handle_t op;mcpwm_operator_config_t oc{};oc.group_id=0;ESP_ERROR_CHECK(mcpwm_new_operator(&oc,&op));ESP_ERROR_CHECK(mcpwm_operator_connect_timer(op,tim));mcpwm_comparator_config_t cc{};cc.flags.update_cmp_on_tez=true;ESP_ERROR_CHECK(mcpwm_new_comparator(op,&cc,&cmp[i]));mcpwm_gen_handle_t gen;mcpwm_generator_config_t gc{};gc.gen_gpio_num=FC_PIN_M1+i;ESP_ERROR_CHECK(mcpwm_new_generator(op,&gc,&gen));ESP_ERROR_CHECK(mcpwm_generator_set_action_on_timer_event(gen,MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP,MCPWM_TIMER_EVENT_EMPTY,MCPWM_GEN_ACTION_HIGH)));ESP_ERROR_CHECK(mcpwm_generator_set_action_on_compare_event(gen,MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP,cmp[i],MCPWM_GEN_ACTION_LOW)));mcpwm_comparator_set_compare_value(cmp[i],1000);}ESP_ERROR_CHECK(mcpwm_timer_enable(tim));ESP_ERROR_CHECK(mcpwm_timer_start_stop(tim,MCPWM_TIMER_START_NO_STOP));gpio_config_t gi{};gi.pin_bit_mask=1ULL<<FC_PIN_IMU_DRDY;gi.mode=GPIO_MODE_INPUT;gi.intr_type=GPIO_INTR_POSEDGE;ESP_ERROR_CHECK(gpio_config(&gi));ESP_ERROR_CHECK(gpio_install_isr_service(ESP_INTR_FLAG_IRAM));ESP_ERROR_CHECK(gpio_isr_handler_add((gpio_num_t)FC_PIN_IMU_DRDY,drdy,nullptr));xTaskCreatePinnedToCore(loop,"fc",8192,nullptr,configMAX_PRIORITIES-1,nullptr,0);xTaskCreatePinnedToCore(rc_task,"rc",4096,nullptr,configMAX_PRIORITIES-2,nullptr,0);ESP_LOGI(TAG,"ready");}
#endif
