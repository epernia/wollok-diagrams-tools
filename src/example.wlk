object myWko1 {
    method myPolimorficMethod1(){
        return "myWko1"
    }
}

object myWko2 {
    method myPolimorficMethod1(){
        return "myWko2"
    }
}

class MyAbstractClass {
    method myAbstractMethod1()
}

class MyClass inherits MyAbstractClass {
    const property aConstant = 10
    const property aList = [1,2,3]
    const property aSet = #{1,2,3,3}
    var property aBoolean = true
    var myWko = myWko1
    override method myAbstractMethod1(){
        return "Implemented"
    }
    method showWko(){
        return myWko.myPolimorficMethod1()
    }
    method changeWkoBy(newWko){
        myWko = newWko
    }
}
