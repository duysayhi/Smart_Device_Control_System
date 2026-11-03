package local.phonecommander.observer;
import android.app.*;import android.os.*;import android.content.*;import android.media.projection.*;import android.provider.Settings;import android.widget.*;
public class ConsentActivity extends Activity {
 private TextView status;
 public void onCreate(Bundle saved){super.onCreate(saved);LinearLayout box=new LinearLayout(this);box.setOrientation(1);box.setPadding(24,24,24,24);setContentView(box);
  TextView notice=new TextView(this);notice.setText("Share this screen with Phone Commander over USB. Accessibility observation is limited to YouTube; it does not perform taps or read password fields. Android events cannot prove whether a tap was physical. The preview stays blank until Observer is enabled and YouTube is the active window. Recording expires after 10 minutes. Stop revokes pairing and clears memory.");box.addView(notice);
  Button access=new Button(this);access.setText("Open Android Accessibility settings (required for privacy checks)");access.setOnClickListener(v->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));box.addView(access);
  Button start=new Button(this);start.setText("Consent and start screen sharing");start.setOnClickListener(v->{MediaProjectionManager m=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);startActivityForResult(m.createScreenCaptureIntent(),41);});box.addView(start);
  Button stop=new Button(this);stop.setText("Stop sharing and revoke pairing");stop.setOnClickListener(v->{stopService(new Intent(this,CaptureService.class));Hub.stop();status.setText("Stopped. Pairing revoked.");});box.addView(stop);status=new TextView(this);status.setTextIsSelectable(true);box.addView(status);
 }
 protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==41&&result==RESULT_OK&&data!=null){Hub.start();Intent intent=new Intent(this,CaptureService.class).putExtra("result",result).putExtra("projection",data);startForegroundService(intent);status.setText("Pair only with your local Dashboard. Token: "+Hub.token+"\nExpires in 10 minutes. No events or images are written to disk.");}}
}