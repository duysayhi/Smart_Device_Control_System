package local.phonecommander.observer;
import android.accessibilityservice.*;import android.view.accessibility.*;import android.graphics.Rect;import org.json.*;
public class ObserverService extends AccessibilityService {
 private static volatile ObserverService instance;
 protected void onServiceConnected(){instance=this;}
 public void onDestroy(){instance=null;super.onDestroy();}
 static boolean allowedWindow(){ObserverService service=instance;if(service==null)return false;AccessibilityNodeInfo root=service.getRootInActiveWindow();if(root==null)return false;java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(root);boolean safe="com.google.android.youtube".contentEquals(root.getPackageName()==null?"":root.getPackageName());int seen=0;try{while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.removeFirst();try{if(node.isPassword())safe=false;if(++seen>200){safe=false;break;}for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}}finally{node.recycle();}}return safe;}finally{while(!queue.isEmpty())queue.removeFirst().recycle();}}
 private String previousFingerprint;private long previousAt;
 public void onAccessibilityEvent(AccessibilityEvent event){if(!Hub.active()||event==null||event.isPassword()||!"com.google.android.youtube".contentEquals(event.getPackageName()==null?"":event.getPackageName()))return;
  AccessibilityNodeInfo node=event.getSource();if(node==null||node.isPassword())return;
  try{Rect bounds=new Rect();node.getBoundsInScreen(bounds);String target=String.valueOf(node.getViewIdResourceName())+":"+bounds.toShortString();long at=System.currentTimeMillis();JSONObject row=new JSONObject().put("origin","ANDROID_ACCESSIBILITY").put("inputOrigin","UNDETERMINED").put("verification","UNVERIFIED").put("eventType",event.getEventType()).put("deviceUptime",event.getEventTime()).put("at",at).put("windowId",event.getWindowId()).put("packageName","com.google.android.youtube").put("target",new JSONObject().put("resourceId",node.getViewIdResourceName()).put("className",String.valueOf(node.getClassName())).put("bounds",new JSONArray(new int[]{bounds.left,bounds.top,bounds.right,bounds.bottom}))).put("beforeTargetFingerprint",previousFingerprint==null?JSONObject.NULL:previousFingerprint).put("beforeObservedAt",previousAt).put("afterTargetFingerprint",Integer.toHexString(target.hashCode()));
   Hub.event(row);previousFingerprint=Integer.toHexString(target.hashCode());previousAt=at;
  }catch(JSONException ignored){}finally{node.recycle();}
 }
 public void onInterrupt(){previousFingerprint=null;previousAt=0;}
}